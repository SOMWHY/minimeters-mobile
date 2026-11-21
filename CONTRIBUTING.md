# Contributing

Thanks for looking. This repository is the phone side of MiniMeters Mobile: an Expo / React Native
app that receives raw PCM from a desktop plugin over the local network and draws the meters with
Skia.

## Before you start

- **Scope.** Every visualization lives in `@minimetermobile/ui`
  ([`../react-native-minimeters-library`](../react-native-minimeters-library)). This app owns the
  transport, theme wiring, layout persistence and the settings orb. A change that alters how a meter
  looks belongs in the library, not here.
- **Open an issue first** for anything larger than a bug fix.
- **Licence.** MIT. By opening a pull request you agree your contribution is MIT as well.

## Setup

```bash
npm install
npx expo start
```

The library is a workspace symlink with `main = dist/`, so it must be built before this app can
see its latest source:

```bash
cd ../react-native-minimeters-library && npm run build
```

## Checks

Run all four before opening a pull request:

```bash
npm run test             # jest
npx tsc --noEmit         # types
npx expo lint
npx expo export --platform android   # bundling regressions
```

`expo export` is not optional politeness: it is the only check that catches a Metro resolution
failure or a Skia import that only breaks in a production bundle.

## Tests

- Jest and Skia are kept apart on purpose. The library's root entry pulls `react-native-skia`'s
  ESM build, which Jest cannot transform, so component tests import deep paths
  (`@minimetermobile/ui/dist/dashboard`, `.../dist/theme`) and the screen test that renders module
  bodies mocks `./module-bodies`.
- `test/setup.js` provides the AsyncStorage mock.
- `DashboardGrid` renders nothing before it has measured its width; tests drive it with
  `fireEvent(getByTestId('dashboard-grid'), 'layout', {...})`.
- React Native Testing Library 14 returns a **promise** from `render()` — always `await` it, or the
  returned object has no query methods.
- `Pressable`'s `props.onPress` is not a function; use `fireEvent.press`.

## Conventions

- Conventional Commits: `feat(scope): ...`, `fix(scope): ...`, `docs`, `refactor`, `test`, `chore`.
  One logical change per commit.
- **A native change means a version bump.** `runtimeVersion.policy` is `appVersion`, so icons,
  splash screens, new native modules or permission changes must bump `version` in `app.json`.
  Without that bump, over-the-air updates are published to a runtime no installed app reports, and
  they silently reach nobody.
- No new native dependency without a note in the pull request: it breaks OTA for every installed
  version.
- The app is bilingual: every user-visible string goes through `src/i18n`, never inline.

## Pull requests

- Describe the device and Android version you tested on. Emulator-only verification is worth
  stating explicitly.
- Include a screenshot or recording for anything the user can see.
- A maintainer runs the checks and a device build before merging; do not merge your own pull
  request.

## Reporting bugs

Include:

- Phone model, Android/iOS version, app version (shown in the settings panel)
- Desktop side: plugin or standalone, and its version
- What the app shows: connected / reconnecting / the pairing error text
- Whether the desktop window's status line says `Network: unavailable`

Connection failures are almost always the desktop side: the port is held by another instance, or
Windows Firewall blocks inbound TCP 8422.
