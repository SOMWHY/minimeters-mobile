# Raw PCM Scan-and-Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scan the plugin pairing QR code on a physical phone, authenticate to the unchanged server, and display live raw PCM samples and frame metadata.

**Architecture:** Keep pairing validation and PCM v1 decoding as pure tested modules. A small WebSocket client owns authentication, state transitions, and a non-React latest-frame buffer; the Expo Camera screen scans QR codes and samples that buffer about every 100 ms to render the first eight raw sample rows.

**Tech Stack:** Expo SDK 58, Expo Router, `expo-camera` `CameraView`, React Native WebSocket, TypeScript, Jest with `jest-expo`, React Native Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-13-raw-pcm-scan-design.md`

## Global Constraints

- Run on physical iOS/Android phones; web displays that QR scanning is unsupported.
- Preserve the existing pairing JSON, WebSocket `/ws`, authentication messages, and binary PCM protocol v1; do not modify the server.
- Display up to the first eight sample rows from the latest valid frame, with frame metadata; do not calculate meters or normalize the samples.
- Keep each received PCM frame outside React state; refresh the displayed snapshot about every 100 ms.
- Do not add persistence, auto-reconnect, dashboard editing, themes, or frame history in this increment.
- Camera access is the only permission required; no microphone recording.
- Before using Expo APIs, use the SDK 58 documentation. The versioned Expo Camera docs confirm QR barcode scanning, permission hooks, and Expo Go support; use `expo install` for SDK-compatible packages.
- Expo test setup follows Expo's Jest guide (`jest-expo` preset); unit tests use deterministic fixtures, not a live server or physical camera.

## Review Focus

- A QR payload with a valid-looking JSON shape but unsupported version or wrong path must not initiate a socket connection. Test in Task 1.
- A frame whose advertised payload size disagrees with `channels * samplesPerChannel * 4` must be rejected before sample access. Test in Task 2.
- Binary data received before authentication, or an authentication error from the server, must never be shown as a connected stream. Test in Task 3.
- Repeated camera callbacks for one QR must not create parallel sockets; a malformed QR must leave scanning usable. Test in Task 4.
- Unmount/disconnect while the 100 ms display refresh is active must close resources and stop the timer. Test in Task 4.

---

### Task 1: Configure Jest and Validate Pairing QR Payloads

**Files:**
- Modify: `package.json` — add Expo-compatible test dependencies, the `test` script, and Jest preset.
- Create: `src/features/connection/pairing.ts` — pairing payload type and pure parser.
- Create: `src/features/connection/pairing.test.ts` — valid/invalid QR payload tests.

**Interfaces:**
- Produces `PairingPayload = { version: 1; address: string; port: number; path: '/ws'; token: string }`.
- Produces `parsePairingPayload(raw: string): PairingParseResult`, where `PairingParseResult` is either `{ ok: true; payload: PairingPayload }` or `{ ok: false; reason: 'invalid_json' | 'unsupported_version' | 'invalid_payload' }`.
- Consumers in Tasks 3–4 use only validated `PairingPayload` values.

- [ ] **Step 1: Add the Expo Jest test setup**

Run in `minimeters-mobile` on Windows:

```powershell
npx expo install jest-expo jest @types/jest @testing-library/react-native "--" --dev
```

Add `"test": "jest --runInBand"` to `scripts`, and configure:

```json
"jest": {
  "preset": "jest-expo"
}
```

Expected: packages match the installed Expo SDK and `npm test -- --listTests` exits successfully (it may list no tests yet).

- [ ] **Step 2: Write failing pairing parser tests**

```ts
import { parsePairingPayload } from './pairing';

const validPayload = {
  version: 1,
  address: '192.168.1.20',
  port: 8422,
  path: '/ws',
  token: '0123456789abcdef',
};

describe('parsePairingPayload', () => {
  it('accepts the server pairing JSON', () => {
    expect(parsePairingPayload(JSON.stringify(validPayload))).toEqual({
      ok: true,
      payload: validPayload,
    });
  });

  it.each([
    ['malformed JSON', '{'],
    ['unsupported version', JSON.stringify({ ...validPayload, version: 2 })],
    ['empty address', JSON.stringify({ ...validPayload, address: '' })],
    ['invalid port', JSON.stringify({ ...validPayload, port: 65536 })],
    ['wrong path', JSON.stringify({ ...validPayload, path: '/other' })],
    ['empty token', JSON.stringify({ ...validPayload, token: '' })],
    ['unexpected field', JSON.stringify({ ...validPayload, extra: true })],
  ])('rejects %s', (_case, input) => {
    expect(parsePairingPayload(input).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run the focused test and verify it fails**

Run: `npm test -- src/features/connection/pairing.test.ts`

Expected: FAIL because `pairing.ts` does not exist.

- [ ] **Step 4: Implement the smallest typed parser**

Return `invalid_json` only when `JSON.parse` fails; return `unsupported_version` for a non-1 version; validate every required field, integer port range `1..65535`, exact `/ws` path, and nonempty address/token; return `invalid_payload` for remaining shape failures. Reject extra keys to match the server pairing schema. Do not silently coerce strings to numbers or accept extra data types.

Use an `unknown` parse result and a type guard rather than `any`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch {
  return { ok: false, reason: 'invalid_json' };
}
if (!isRecord(parsed)) {
  return { ok: false, reason: 'invalid_payload' };
}
const value = parsed;
```

- [ ] **Step 5: Run the focused test and typecheck**

Run: `npm test -- src/features/connection/pairing.test.ts` and `npx tsc --noEmit`.

Expected: all pairing cases pass and TypeScript reports no errors.

- [ ] **Step 6: Commit the parser/test setup**

```powershell
git add package.json package-lock.json src/features/connection/pairing.ts src/features/connection/pairing.test.ts
git commit -m "feat: validate plugin pairing QR payloads" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Decode PCM Frames and Project Raw Sample Rows

**Files:**
- Create: `src/features/monitoring/pcm-frame.ts` — protocol v1 decoder and display projection.
- Create: `src/features/monitoring/pcm-frame.test.ts` — valid/invalid binary frame coverage.

**Interfaces:**
- Produces `PcmAudioFrame = { timestampMs: number; sampleRate: number; channels: number; samplesPerChannel: number; samples: Float32Array }`; samples remain interleaved.
- Produces `decodePcmFrame(data: ArrayBuffer): PcmDecodeResult`, where invalid frames return a typed error code rather than throwing.
- Produces `selectSampleRows(frame: PcmAudioFrame): SampleRow[]`; each row has `index` and channel values, with at most eight rows.

- [ ] **Step 1: Write a valid little-endian PCM fixture and decoder tests**

The fixture must construct a 32-byte header using `DataView`, write `MMSA`, version `1`, message type `1`, header size `32`, timestamp `123`, sample rate `48000`, channels `2`, samples per channel `2`, format `1`, and payload size `16`. Write four interleaved float32 values `0.25, -0.5, 0.75, -1`.

The header's `channels` and `samplesPerChannel` fields are unsigned 16-bit integers. Accept `channels` 1 or 2 and a nonzero sample count; do not allow arithmetic or payload-length checks to overflow before validating the maximum encoded field values.

Test decoded metadata and the resulting rows:

```ts
expect(selectSampleRows(frame)).toEqual([
  { index: 0, values: [0.25, -0.5] },
  { index: 1, values: [0.75, -1] },
]);
```

Also test mono input, truncation, bad magic/version/message type/header size/sample format, zero/unsupported channels, and payload-size mismatch. Verify more than eight samples produce only the first eight display rows.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/features/monitoring/pcm-frame.test.ts`

Expected: FAIL because the decoder module does not exist.

- [ ] **Step 3: Implement protocol decoding**

Read integer header fields with `DataView` little-endian accessors at offsets `4, 5, 6, 8, 16, 20, 22, 24, 28`; calculate the millisecond timestamp from the low/high uint32 words at offsets `8` and `12`. Validate magic/version/type/header/format, nonzero sample rate/count, and channel count `1..2` before reading samples. Require the exact frame length to equal `32 + channels * samplesPerChannel * 4`, and require the payload-size header to match that calculated size. Decode samples with `getFloat32(offset, true)`. Return explicit error codes for short header, invalid magic, unsupported version/type/format, invalid metadata, and inconsistent payload size.

The core decoding loop should follow this shape after all metadata and length checks:

```ts
const view = new DataView(data);
const samples = new Float32Array(channels * samplesPerChannel);
for (let index = 0; index < samples.length; index += 1) {
  samples[index] = view.getFloat32(32 + index * 4, true);
}
```

- [ ] **Step 4: Implement the display projection**

Return at most `Math.min(8, frame.samplesPerChannel)` rows. For row `i`, use interleaved offsets `i * frame.channels + channel`; return one value for mono and two values for stereo. Do not compute peak, RMS, normalization, or historical data.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- src/features/monitoring/pcm-frame.test.ts` and `npx tsc --noEmit`.

Expected: all valid/malformed fixture cases pass, and TypeScript reports no errors.

- [ ] **Step 6: Commit the decoder/projection**

```powershell
git add src/features/monitoring/pcm-frame.ts src/features/monitoring/pcm-frame.test.ts
git commit -m "feat: decode raw PCM protocol frames" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Implement an Authenticated PCM WebSocket Client

**Files:**
- Create: `src/features/connection/pcm-socket-client.ts` — WebSocket lifecycle and latest-frame buffer.
- Create: `src/features/connection/pcm-socket-client.test.ts` — fake-socket lifecycle tests.

**Interfaces:**
- Consumes `PairingPayload` from Task 1 and `decodePcmFrame`/`PcmAudioFrame` from Task 2.
- Produces `PcmConnectionState = 'connecting' | 'authenticating' | 'connected' | 'disconnected' | 'error'`.
- Produces `PcmSocketClient`, with `connect(): void`, `disconnect(): void`, `getLatestFrame(): PcmAudioFrame | null`, and `getReceivedFrameCount(): number`.
- Constructor takes `pairing`, callbacks (`onState`, `onProtocolError`), and an injectable `SocketFactory` for deterministic tests.

- [ ] **Step 1: Write fake-socket tests**

Verify that:

1. `connect()` emits connecting, opens `ws://192.168.1.20:8422/ws`, and sends exactly `{"type":"authenticate","version":1,"token":"0123456789abcdef"}` on socket open.
2. The state remains authenticating until `{"type":"authenticated","version":1,"sampleFormat":"f32le"}` arrives, then becomes connected.
3. An `invalid_token` error becomes an error state and is not treated as a successful connection.
4. Binary PCM before authentication is ignored and reported.
5. Authenticated valid PCM replaces the latest-frame buffer and increments its count; malformed PCM emits a protocol error without crashing.
6. `disconnect()` closes the socket, clears the latest-frame buffer and frame count, and reports disconnected; a remote close clears the active session and reports disconnected.

Use an injected factory shaped as:

```ts
type SocketHandlers = {
  onOpen(): void;
  onMessage(data: unknown): void;
  onError(): void;
  onClose(): void;
};
type SocketFactory = (
  url: string,
  handlers: SocketHandlers,
) => { send(data: string): void; close(): void };
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/features/connection/pcm-socket-client.test.ts`

Expected: FAIL because the client module does not exist.

- [ ] **Step 3: Implement the native WebSocket adapter and client**

The default factory creates `new WebSocket(url)`, sets `binaryType = 'arraybuffer'`, and forwards open/message/error/close events to the injected handlers:

```ts
const socket = new WebSocket(url);
socket.binaryType = 'arraybuffer';
socket.onopen = () => handlers.onOpen();
socket.onmessage = (event) => handlers.onMessage(event.data);
socket.onerror = () => handlers.onError();
socket.onclose = () => handlers.onClose();
```

Build the URL from the validated pairing fields. Send authentication only after `onOpen`. Parse text controls, require protocol version `1` and sample format `f32le` for the authenticated response, and do not accept binary frames until authenticated. For valid authenticated binary frames, replace the latest frame and increment a monotonically increasing frame count. Use typed decode results; report malformed frames with `onProtocolError` and keep the socket available for later valid frames. On a server authentication error, report the error state and close the socket. Ensure disconnect clears callbacks/active socket and frame data so late events cannot revive state.

- [ ] **Step 4: Run client tests and typecheck**

Run: `npm test -- src/features/connection/pcm-socket-client.test.ts` and `npx tsc --noEmit`.

Expected: all fake-socket cases pass with no TypeScript errors.

- [ ] **Step 5: Commit the client**

```powershell
git add src/features/connection/pcm-socket-client.ts src/features/connection/pcm-socket-client.test.ts
git commit -m "feat: receive authenticated PCM over websocket" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Add the Phone QR Scanner and Live Raw PCM Screen

**Files:**
- Modify: `package.json` and `package-lock.json` — install the SDK-compatible Expo Camera package.
- Modify: `app.json` — add Expo Camera config with a camera-only permission message and no Android microphone permission.
- Modify: `src/app/index.tsx` — render the monitor screen in the existing home route.
- Create: `src/features/monitoring/PairingScanner.tsx` — permission-aware QR-only scanner.
- Create: `src/features/monitoring/PcmMonitorScreen.tsx` — connection actions, status, metadata, sample rows, throttled display refresh.
- Create: `src/features/monitoring/PairingScanner.test.tsx` and `src/features/monitoring/PcmMonitorScreen.test.tsx` — native-component tests with mocked camera/socket.

**Interfaces:**
- Scanner consumes `active: boolean` and `onQrScanned(data: string): void`; it requests camera permission using Expo Camera and accepts QR codes only.
- Screen consumes the parser and client interfaces from Tasks 1–3; tests inject a fake client factory.
- Display refresh reads `getLatestFrame()` and `getReceivedFrameCount()` on a 100 ms interval; the socket message handler does not call React state setters.

- [ ] **Step 1: Install the Expo SDK-compatible camera dependency**

Run: `npx expo install expo-camera`.

Add the `expo-camera` config plugin to `app.json` with an explicit QR-pairing camera permission message and `recordAudioAndroid: false`. The app requests camera access only and does not request microphone permission at runtime. Do not add `android/` or `ios/` folders manually.

- [ ] **Step 2: Write scanner and screen tests with native mocks**

Mock `expo-camera`'s `CameraView` and `useCameraPermissions`, then test:

- Web platform shows the unsupported-device message without rendering a camera.
- Undetermined permission offers a request action; granted permission renders a QR-only camera.
- Denied permission shows an explanation and a retry action.
- One scanned QR invokes the callback once; malformed QR leaves scanning active for another scan.
- Two rapid valid QR callbacks while connecting create one client only.
- An invalid QR payload, including a wrong path, never invokes the socket client factory.
- Authenticated sample data updates the displayed metadata and up to eight raw rows on the 100 ms cadence, with no Peak/RMS text or conversions.
- Disconnect and unmount close the client and clear the interval.

- [ ] **Step 3: Run UI tests and verify they fail**

Run: `npm test -- src/features/monitoring/PairingScanner.test.tsx src/features/monitoring/PcmMonitorScreen.test.tsx`

Expected: FAIL because the scanner and monitor screen do not exist.

- [ ] **Step 4: Implement the scanner**

Use SDK 58's `CameraView`, `useCameraPermissions`, `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`, and `onBarcodeScanned`. Request permission only in response to the user's action. Stop/unmount the camera after accepting a valid QR; on invalid QR, show a recoverable error and resume scanning. Do not render camera UI on web.

- [ ] **Step 5: Implement the monitor screen**

Provide scan, cancel, and disconnect actions; show explicit connecting/authenticating/connected/disconnected/error states; display the current frame timestamp, sample rate, channel count, samples-per-channel, and received frame count. Render sample values as their decoded numeric values without meter conversion. Keep the `PcmSocketClient` and latest frame outside React state. Start a 100 ms interval only while connected, project the latest frame with `selectSampleRows`, and store only that bounded display snapshot in React state. Clear the interval and close the client on disconnect/unmount.

- [ ] **Step 6: Run UI tests, all tests, lint, and typecheck**

Run:

```powershell
npm test -- src/features/monitoring/PairingScanner.test.tsx src/features/monitoring/PcmMonitorScreen.test.tsx
npm test -- --runInBand
npm run lint
npx tsc --noEmit
```

Expected: all tests, lint, and typecheck pass.

- [ ] **Step 7: Validate on a physical phone**

Run `npx expo start`, open the project in Expo Go on a physical phone, grant camera access, and scan the pairing QR displayed by the server plugin. Play audio and verify raw sample values change; compare metadata and sample values against the existing Python test client's PCM stream. Also check denied permission, malformed QR, server disconnect, invalid frame, and web unsupported message. No Android Studio/emulator is required.

- [ ] **Step 8: Commit the end-to-end UI**

```powershell
git add package.json package-lock.json app.json src/app/index.tsx src/features/monitoring
git commit -m "feat: scan pairing QR and monitor raw PCM" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Self-Review

- Spec coverage: QR scan, payload validation, authentication, PCM v1 frame validation, metadata, eight-row raw sample projection, throttled rendering, permission/error handling, explicit disconnect, and physical-device validation are assigned to Tasks 1–4.
- No placeholder steps: every task names files, interfaces, commands, test cases, and expected outcomes.
- Type consistency: the validated `PairingPayload` feeds the client; the client exposes the latest `PcmAudioFrame`; projection produces at most eight rows consumed by the monitor screen.
- Review Focus inputs are covered by explicit tests in their owning tasks.
- Expo SDK 58 camera docs confirm Expo Go support and `CameraView` QR scanning. Expo Jest guide provides the `jest-expo` preset and Windows dev dependency install syntax.
