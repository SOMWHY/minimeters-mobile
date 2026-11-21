# Privacy Policy — MiniMeters Mobile

Last updated: 2026-11-21

MiniMeters Mobile is a local-network companion app. It does not require an account, does not
contain analytics or advertising SDKs, and does not upload your audio.

## What the app handles

**Audio.** The desktop plugin or standalone captures audio from your computer and streams the raw
samples to this app over a WebSocket connection on your local network. The samples are analysed in
memory on the phone to draw the meters and are discarded immediately afterwards. They are never
written to storage, never uploaded to any server, and never leave your local network.

**Pairing data.** When you pair, the app stores the desktop's address, port and the issued device
token so that later launches reconnect without scanning the QR code again. This is stored in the
app's local storage (`AsyncStorage`) on your device only.

**Preferences.** The dashboard layout, colour theme, fullscreen setting and settings-orb position
are stored locally on your device.

There is no account, no sign-in, no cloud sync, and no way for us to read any of the above.

## Network connections the app makes

| Destination | Purpose | When |
| --- | --- | --- |
| Your computer's LAN address on TCP **8422** | Receive audio frames and pairing handshakes | While connected |
| `u.expo.dev` (Expo Updates) | Check for and download app updates | On launch, and when you accept an update |

The application-update check sends the app version and runtime version so the update service can
return a compatible bundle. It does not send your audio, your pairing token, or any identifiers
about your device beyond the standard HTTP request.

The app may open a link in your browser (for example a licence or project page). That page is
served by a third party and is governed by its own privacy policy.

## Permissions

| Permission | Why |
| --- | --- |
| Camera | Exclusively to scan the pairing QR code. No photos or video are captured, stored or transmitted. |

## Data retention and deletion

Everything the app stores lives in its local storage. Uninstalling the app removes all of it. You
can also unpair at any time from the desktop side ("Forget devices"), which invalidates the device
tokens.

## Children

The app is not directed at children and collects no personal data.

## Changes

Material changes to this policy will be noted in the release notes of the version that introduces
them.

## Contact

Open an issue at <https://github.com/SOMWHY/minimeters-mobile/issues>.
