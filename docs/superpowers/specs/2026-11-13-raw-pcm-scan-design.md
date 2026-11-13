# Raw PCM Scan-and-Monitor Design

## Goal

Let a user scan the pairing QR code displayed by the MiniMetersMobile plugin and see live raw audio sample values received by the phone. This first increment is a transport/debugging view, not an audio meter or a finished dashboard.

## Scope

Included:

- In-app QR scanning on a physical iOS or Android phone.
- Parse and validate the existing pairing JSON payload.
- Connect to the server's existing `ws://<address>:<port>/ws` WebSocket endpoint and authenticate with the pairing token.
- Receive and validate protocol v1 binary PCM frames.
- Show connection state, frame metadata, and up to the first eight sample rows from the latest decoded frame.
- Update the display on a throttled UI cadence while retaining the newest frame outside React state.
- Handle camera permission, malformed QR payloads, server authentication errors, invalid frames, and connection closure visibly.

Not included:

- Peak/RMS, LUFS, spectrum, waveform drawing, or any other analysis/rendered meter.
- Persisting pairing credentials, automatic reconnect, dashboard editing, themes, or settings.
- Server changes or protocol changes.
- Web-camera scanning; web should display a clear unsupported-platform message.
- A full frame history or a user-selectable sample count.

## Existing contract

The server sends a JSON pairing object with `version`, `address`, `port`, `path`, and `token`. The client connects over WebSocket, sends a JSON `authenticate` request, and waits for an `authenticated` response. Audio arrives as binary protocol v1 frames: a 32-byte little-endian header followed by interleaved little-endian IEEE-754 `float32` samples.

No analysis fields are sent. The phone must display sample values decoded from PCM without presenting them as calculated meter values.

## UX and data flow

The initial app screen becomes a connection/PCM monitor:

1. The user taps a scan action and grants camera permission if requested.
2. The camera scans QR codes only. A scan is accepted once; the camera is paused while parsing and connecting to prevent duplicate connection attempts.
3. The app validates the JSON pairing payload and opens the WebSocket using the supplied address, port, and path.
4. The app sends `authenticate`. It shows a connected/authenticated state only after receiving the matching success response.
5. For each binary audio frame, the decoder validates the header and exact payload length, then decodes interleaved channel samples.
6. A non-subscribed latest-frame buffer retains the latest valid frame. The UI samples that buffer about every 100 ms and displays up to the first eight sample rows from that frame, together with timestamp, sample rate, channel count, samples per channel, and a received-frame counter. Stereo rows show L/R; mono rows show the single channel without inventing a second value.
7. An explicit disconnect action closes the socket and returns to a ready-to-scan state.

Stereo sample rows are labeled L/R; mono rows show the single channel. Values are displayed as decoded float32 numbers, without Peak/RMS conversion or normalization. The UI refresh timer only controls how often the display reads the buffer; connection state is driven by actual camera, WebSocket, and protocol events.

## Implementation boundaries

- Keep QR payload validation, control-message handling, and PCM frame decoding in testable non-screen modules.
- Keep WebSocket ownership and connection lifecycle in a focused client/service module; the screen presents state and actions.
- Do not put every incoming PCM frame in React state. Only connection/error state and the throttled display snapshot may trigger renders.
- Preserve the current server protocol as-is. Any protocol mismatch should be reported explicitly rather than silently adapted.
- Use Expo Camera's QR-only barcode scanning and permission APIs. Expo SDK 58's official Camera docs list Android/iOS device support and Expo Go inclusion; no local Android Studio or emulator is required for the intended phone test.

## Error behavior

- Denied camera permission: explain that camera access is required and provide a retry-to-request action.
- Malformed/unsupported QR payload: show a recoverable error and resume scanning.
- Socket open/authentication failure: show the stage and server message/code when available; do not mark as connected.
- Invalid binary frame: report a protocol/data error and ignore the frame without crashing.
- Socket close/error: show disconnected/error state, stop the live display timer when appropriate, and release camera/socket resources.
- Unsupported web platform: explain that QR scanning is available on a physical device.

## Validation

Unit tests:

- Pairing JSON valid payload and invalid version/address/port/path/token.
- Authentication success and server error handling.
- PCM v1 decoding of known mono/stereo samples and metadata.
- Rejection of bad magic/version/header size, unsupported format, inconsistent payload length, and truncated frames.
- Display projection selects up to eight sample rows, respects mono/stereo channel counts, and reports metadata without applying meter calculations.

Manual phone validation:

- Run the app in Expo Go on a physical phone, grant camera access, and scan the plugin's QR code.
- Confirm authenticated state and changing sample values while the DAW plays.
- Confirm displayed metadata matches the frame stream and sample values remain within the PCM source values.
- Deny camera permission, scan malformed JSON, disconnect the server, and confirm recoverable UI states.
- Confirm updates appear live without a React render for every received frame.

## Success criteria

The user can scan the actual plugin QR code on a physical phone, authenticate to the unchanged server, and see changing raw float32 sample values for the available channel(s), plus current PCM frame metadata. Malformed inputs and disconnects do not crash the app. No audio analysis or server/protocol modification is introduced in this increment.
