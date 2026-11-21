**English** · [简体中文](platform-support.zh-CN.md)

# Platform support

What has actually been run, what has only been built, and what would be needed for the platforms
that cannot run the app today.

Status snapshot: 2026-11-21.

## Summary

| Platform | Runs the app | On real hardware | Blocking gap |
| --- | --- | --- | --- |
| Android | yes | yes | — |
| iOS 16+ | yes (built, not installed) | **no** | no iPhone/Mac available to the project |
| HarmonyOS 4.x / EMUI | yes (APK) | **no** | needs a Huawei test device |
| HarmonyOS NEXT 5.0+ | **no** | no | no AOSP layer; requires a `.hap` |
| Web | no | — | Skia needs CanvasKit; layout assumes native |

## Android — verified

Reference platform. Verified end to end: pairing (QR and manual), streaming, all seven modules,
layout editing, theme switching, fullscreen toggle, and layout/orb persistence across restarts.

Notes:

- Fullscreen hides both system bars through `expo-navigation-bar`'s `setVisibilityAsync`. With
  edge-to-edge enforced on recent Android versions, hiding is the only supported behaviour, and an
  edge swipe reveals the bars temporarily. Reapplied on `AppState` → `active`, restored on unmount.
- Predictive back is disabled (`android.predictiveBackGestureEnabled: false`).

## iOS — built, not hardware-verified

Everything that can be checked without a Mac or an iPhone has been checked:

| Check | Command | Result |
| --- | --- | --- |
| Config plugins produce the right `Info.plist` | `npx expo config --type introspect` | `NSLocalNetworkUsageDescription`, `NSAppTransportSecurity.NSAllowsLocalNetworking`, `NSCameraUsageDescription` all present |
| iOS JS bundle builds | `npx expo export --platform ios` | `entry-*.hbc`, 4.4 MB Hermes bytecode |
| Types / tests / lint | `tsc --noEmit`, `jest`, `expo lint` | clean |

**Not verified** (requires hardware or a simulator): Skia rendering on Metal, safe-area insets on a
notched device, the actual local-network permission prompt, gesture behaviour, and the fullscreen
toggle's status-bar-only effect.

Two `Info.plist` keys are mandatory — without them a phone on the same Wi-Fi cannot pair at all,
and the failure surfaces as a bare `Network request failed`:

```json
"NSLocalNetworkUsageDescription": "…",
"NSAppTransportSecurity": { "NSAllowsLocalNetworking": true }
```

The first is the iOS 14+ local network privacy prompt; the second is the ATS exception that lets
`ws://` (cleartext) reach a LAN address. `NSAllowsLocalNetworking` is narrower than
`NSAllowsArbitraryLoads`, which matters for App Store review.

### Routes to a real iOS check, cheapest first

1. **Someone else's iPhone + Expo Go** — `npx expo start --tunnel`, they scan, done. Verifies Skia,
   pairing, fullscreen. Free.
2. **Unsigned simulator build in a browser** — `npx eas build -p ios --profile preview-simulator`
   produces a `.app`; upload it to Appetize.io or BrowserStack App Live. **No Apple account
   needed** (simulator builds are not signed).
3. **Rented cloud Mac** — MacinCloud / MacStadium / a cloud macOS instance, roughly ¥1–3/hour.
   Closest to real debugging: Xcode simulator plus a live Metro connection.
4. **Second-hand iPhone SE (2nd/3rd gen)** — a few hundred yuan, the durable option. Installing a
   signed build still requires an Apple Developer account ($99/yr) for TestFlight/ad-hoc.

## HarmonyOS 4.x / EMUI — expected to work, untested

Huawei devices up to roughly the Mate 60 generation still carry the AOSP compatibility layer, so
the APK installs and behaves like Android. The only user action is disabling 纯净模式
(Settings → 系统和更新 → 纯净模式) and allowing installs from unknown sources.

To test: `npx eas build --profile preview --platform android` (the `preview` profile emits an
`.apk`), transfer it to the phone, install.

The **manual pairing** entry was added specifically for this path: a device where the camera is
blocked or unavailable can still pair by typing the address and token printed next to the QR code.

## HarmonyOS NEXT 5.0+ — unsupported

HarmonyOS NEXT removed the AOSP layer, the ART runtime, and the Java SDK. APKs do not install at
all (`无法打开文件` / unsupported format). Native applications are `.hap` packages written in
ArkTS with ArkUI.

Three options, in ascending cost:

1. **Do nothing and document it.** Recommended for now.
2. **Compatibility layers.** Huawei documents 卓易通 (DroiTong) and, regionally, 出境易 for running
   Android apps. An APK may install and still lose camera, notifications, background execution,
   or DRM. Manual pairing makes the app usable in this mode; treat it as best effort.
3. **A real HAP port.** This is a separate project, not a build flag:

   - React Native on OpenHarmony is RNOH (`gitee.com/openharmony-sig/ohos_react_native`), a
     separate release line from upstream React Native. The mainline port is based on RN 0.72.5.
   - The community Expo bridge (`expo-harmony`) targets Expo SDK 55 with RNOH 0.84.1. This project
     is **Expo SDK 58 / RN 0.88.1** — the versions do not line up.
   - `@shopify/react-native-skia` has an OpenHarmony port (`@react-native-ohos/react-native-skia`)
     that is still on the 1.3.7 / RN 0.77 generation, i.e. older than the version this app uses.
   - Every visualization is Skia; there is no fallback renderer.

   Before any port work, validate the risk with a one-screen spike: a Skia-rendered waveform fed
   from a hardcoded buffer, running on a DevEco Studio simulator. If that fails, the port is not
   worth scoping.

## Web — unsupported

`expo export --platform web` may produce a bundle, but `react-native-skia` requires the CanvasKit
WASM build, and `useDashboardLayout` / the orb rely on native window metrics. Not a target.
