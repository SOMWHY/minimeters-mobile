# MiniMeters Mobile

Phone-side dashboard for [MiniMeters](https://minimeters.app), built with Expo + React Native.
The desktop app (JUCE plugin / standalone, in `../MiniMetersMobileServer`) captures audio, streams
raw PCM frames over a WebSocket, and this app re-draws the meters on a phone with Skia.

## Download (Android)

Grab the latest APK from [Releases](https://github.com/SOMWHY/minimeters-mobile/releases/latest):

1. Download `minimeters-mobile-<version>-arm64.apk` and `SHA256SUMS.txt`.
2. Optional but recommended — verify the download:
   ```powershell
   certutil -hashfile minimeters-mobile-<version>-arm64.apk SHA256
   ```
   The value must match the line in `SHA256SUMS.txt`.
3. Install it. Android will warn that the app comes from an unknown source and that it was not
   scanned by Play Protect — this is expected, the app is not distributed through Google Play.
   Allow the install and choose "install anyway".
4. Open the app and scan the QR code shown in the desktop plugin or standalone window.

Requirements: Android 8.0+, **arm64 only** (no 32-bit or x86 build is published), phone and
computer on the same local network, desktop side reachable on TCP 8422.

No audio ever leaves your device: the phone receives raw PCM over the local network only. See
[`PRIVACY.md`](PRIVACY.md).

## Architecture

```
desktop (JUCE)                        phone (Expo)
  audio callback ──▶ AudioBlockQueue ──▶ WebSocket :8422/ws ──▶ PcmSocketClient
                                                                     │ newest frame
  analysis + Skia modules  ◀── @minimetermobile/ui ◀── usePcmStream ◀┘ (polled at 30 Hz)
```

- **`@minimetermobile/ui`** (`../react-native-minimeters-library`) owns every visualization:
  waveform, spectrum, spectrogram, VU, LUFS, oscilloscope, and the grid/layout model.
- **This app** owns the transport, the theme wiring, the dashboard layout persistence, and the
  settings orb. It does no DSP beyond mapping linear values onto the module scale.
- One frame in flight: the client keeps only the newest frame, the UI drains it on a timer, so a
  30 fps stream cannot outrun the render budget.

## Getting started

```bash
npm install
npx expo start          # Metro; open on a device or emulator
```

The library is a workspace symlink with `main = dist/`, so after changing its source:

```bash
cd ../react-native-minimeters-library && npm run build
```

### Pairing

The desktop window shows a QR code plus the same values as text:

```
Address: 192.168.1.20:8422
Path: /ws
Token: <short-lived pairing token>
```

- **Scan the QR code** (camera), or
- **Enter address manually** — type `192.168.1.20:8422` and the token. Also accepts a bare host
  (defaults to port 8422), a `ws://host:port/ws` URL, a bracketed IPv6 literal, or the whole QR
  JSON pasted into the address field.

The first handshake issues a device token, so later launches reconnect without the QR. The QR
token expires; the device token does not.

Windows firewall must allow inbound TCP **8422** for the phone to reach the desktop.

## Platform support

| Platform | Status | Notes |
| --- | --- | --- |
| **Android (arm64)** | ✅ Verified on device — reference platform | Fullscreen mode hides the status and navigation bars via `expo-navigation-bar`; edge-swipe reveals them temporarily |
| **iOS 16+** | ⚠️ Code ready, **not verified on hardware** | No iPhone or Mac available to the project. `Info.plist` declares local-network access and the ATS LAN exception (both required, see below); the iOS JS bundle and config introspection build clean. Skia/Metal rendering, safe areas, and the local-network prompt are unverified |
| **HarmonyOS 4.x / EMUI** (AOSP-based) | ⚠️ Expected to work — untested | Still runs APKs. Turn off 纯净模式, then install the `preview` APK. The manual pairing entry exists for exactly this case |
| **HarmonyOS NEXT 5.0+** | ❌ Unsupported | No AOSP layer, so APKs cannot install; needs a native `.hap` (RNOH). Compatibility layers such as 卓易通/出境易 can sometimes run the APK — capability loss is expected |
| **Web** | ❌ Unsupported | `react-native-skia` needs CanvasKit and the dashboard assumes native layout metrics |

Details, evidence, and the cost of a HarmonyOS NEXT port: [`docs/platform-support.md`](docs/platform-support.md).

### iOS-specific configuration

Two keys are mandatory and are already in `app.json`:

| Key | Without it |
| --- | --- |
| `NSLocalNetworkUsageDescription` | iOS 14+ blocks LAN access silently; RN reports only `Network request failed` |
| `NSAppTransportSecurity.NSAllowsLocalNetworking` | ATS rejects the cleartext `ws://` connection |

### Building

`eas.json` defines five profiles:

| Profile | Output | Needs Apple account |
| --- | --- | --- |
| `development` | dev client (internal) | no |
| `preview` | **installable APK** — internal testing, `preview` OTA channel | no |
| `release` | **public APK** — GitHub Releases, `production` OTA channel, auto-incremented versionCode | no |
| `preview-simulator` | unsigned iOS simulator `.app` — runnable in a browser (Appetize/BrowserStack) or a rented Mac | **no** |
| `production` | app bundle (Play) / signed IPA | yes, for iOS |

```bash
npx eas build --profile release --platform android     # public APK
npx eas build --profile preview --platform android     # internal APK
npx eas build --profile preview-simulator --platform ios
```

Release procedure (keys, checksums, GitHub Release, OTA): [`docs/RELEASING.md`](docs/RELEASING.md).

## Development

```bash
npm run test            # jest
npx tsc --noEmit        # types
npx expo lint
npx expo export --platform android   # catches bundling regressions
```

Jest isolates Skia: component tests import `@minimetermobile/ui/dist/...` deep paths, and the
screen test that renders module bodies mocks `./module-bodies`.

## Known gaps

- iOS and HarmonyOS have never run on real hardware (see the support matrix).
- Frame-rate slicing (waveform 20 Hz / spectrum 15 Hz / header 10 Hz) — the engine still runs an
  FFT per 33 ms frame.
- VU/LUFS use exponential millisecond ballistics rather than a dB-domain 24 dB/s release.
- Waveform history window is 3 s.
