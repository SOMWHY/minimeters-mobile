# Releasing

Two artifacts ship from this repository and `../MiniMetersMobileServer`:

| Artifact | Where it goes | Version source |
| --- | --- | --- |
| Android APK | GitHub Releases of `SOMWHY/minimeters-mobile` | `expo.version` + EAS-managed `versionCode` |
| Windows plugin (`vst3` + `clap` + `exe`) | GitHub Releases of `SOMWHY/MiniMetersMobileServer` | `project(... VERSION x.y.z)` in `CMakeLists.txt` |

There is no Google Play listing and no Apple build in the current flow. Because the APK is
sideloaded, **the signing key is the app's identity** — losing it means every installed user must
uninstall and reinstall.

## 0. One-time setup

### 0.1 Back up the Android signing key (do this first)

EAS generated and stores the keystore remotely (`eas.json` has no `credentialsSource`, so the
default `remote` applies).

```bash
npx eas credentials          # Android -> Keystore -> Download existing keystore
```

Then:

1. Store the `.jks` plus its alias and passwords in a password manager **and** one offline copy.
2. Record the certificate fingerprint and keep it in this document's release table:

```bash
apksigner verify --print-certs minimeters-mobile-<version>-arm64.apk
```

```
Signer #1 certificate SHA-256 digest:
0A:78:F0:22:07:78:4E:40:A6:7B:1D:AB:8A:84:1E:14:AD:BB:6C:2B:7E:71:C3:A6:B1:13:00:2A:31:5A:06:20
Valid from: 2026-11-21 (EAS-managed keystore)
```

Verified against both `1.0.0-preview-ota` (versionCode 1) and `1.0.0` release (versionCode 2),
so installs update in place. If `apksigner` is unavailable, `build-artifacts/apksig-cert.js`
parses the v2 signing block and prints the same digest.

The fingerprint changing between releases is a red flag: it means the keystore was replaced and
existing installs can no longer be updated in place.

### 0.2 Tooling

- `npx eas-cli` authenticated as `som_why`
- `gh` authenticated (`gh auth login`) with write access to both repositories
- Android `aapt`/`apksigner` (any build-tools copy) for verification

## 1. Android APK

### 1.1 Build

```bash
npx eas build -p android --profile release
```

- Profile `release` produces an **APK** (not an AAB), `arm64-v8a` only, channel `production`,
  `versionCode` auto-incremented from EAS's remote counter.
- The profile carries `:app:assembleRelease --max-workers=2`. **Do not remove it** — the EAS
  worker has 4 vCPU / 15.6 GB and Gradle's daemon gets OOM-killed without the cap. This has
  already happened once (`Gradle build daemon disappeared unexpectedly`).

### 1.2 Verify before publishing

```bash
aapt dump badging minimeters-mobile-<version>-arm64.apk   # package, versionCode, versionName, permissions
apksigner verify --print-certs minimeters-mobile-<version>-arm64.apk
```

Checklist:

- package `com.minimeters.mobile`, versionName matches the tag
- versionCode is **greater than the previous release**
- declared permissions: `android.permission.CAMERA` only (no duplicates, nothing else)
- certificate SHA-256 equals the archived fingerprint from 0.1

### 1.3 Checksums and release

```bash
sha256sum minimeters-mobile-<version>-arm64.apk > SHA256SUMS.txt   # certutil -hashfile on Windows
gh release create v<version> \
  minimeters-mobile-<version>-arm64.apk SHA256SUMS.txt \
  --title "MiniMeters Mobile <version>" \
  --notes-file docs/releases/v<version>.md
```

Release notes must state: minimum Android version, arm64-only, same-LAN requirement, desktop
firewall port 8422, the signing fingerprint, and that the app is not distributed via Google Play.

### 1.4 OTA update (JS-only changes)

Only for changes that touch no native code, no `app.json` native keys, and no dependency with a
native module.

```bash
npx eas update --branch production --platform android --environment production \
  --message "what changed" --non-interactive
```

- `--environment` is mandatory with `--non-interactive`.
- The app checks silently on launch and shows a notice only when an update exists; nothing is
  downloaded until the user taps it.
- `runtimeVersion.policy = appVersion`, so an OTA update only reaches builds whose `version`
  matches. **Bump `version` whenever native code changes**, then ship a new APK.

## 2. Protocol compatibility

The pairing/audio protocol is versioned (`version: 1` in the pairing payload and the
`authenticated` message).

- Any change to protocol fields requires a version bump and a **paired release**: plugin and app
  ship together, in either order, but both must be available.
- The plugin reports its own version and the minimum app version it accepts; the app must surface
  an actionable message ("update the plugin on your computer") instead of failing silently.

## 3. Plugin (Windows)

See `../MiniMetersMobileServer/docs/RELEASING.md` for the plugin side: zip layout, GPLv3
obligations, checksums and the GitHub Release job.

## 4. Release checklist

```
[ ] keystore backed up, fingerprint unchanged
[ ] tag == expo.version
[ ] versionCode > previous
[ ] permissions unchanged (CAMERA only)
[ ] apksigner fingerprint verified
[ ] SHA256SUMS.txt generated and uploaded
[ ] release notes contain signature + install steps
[ ] README download link points at the new release
[ ] OTA published if the change was JS-only
[ ] plugin released and its minimum app version is satisfied by this build
```
