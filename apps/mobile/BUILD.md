# FizzDragon Mobile — Release Build Guide

One command produces all store-ready, signed packages. No manual config edits.

```bash
npm run build:release <region> <platform>
#   region   = global | cn | all
#   platform = ios | android | all
```

Output → `$FD_OUT_DIR` (default `~/Desktop/FizzDragon-builds/`), named
`FizzDragon-<version>-<build>-<variant>.<ext>`.

## What gets built

| region | platform | variant         | identifier                 | store            | signing                                |
| ------ | -------- | --------------- | -------------------------- | ---------------- | -------------------------------------- |
| global | android  | `global.aab`    | `com.fizzdragon`           | Google Play      | `android-global-googleplay` upload key |
| global | ios      | `global.ipa`    | `com.fizzdragon.app`       | App Store (intl) | manual, team `273BAZ5UTL` + profile    |
| cn     | android  | `cn-huawei.apk` | `cn.fizzdragon`            | 华为             | `android-cn` 沸腾繁星 key              |
| cn     | android  | `cn-xiaomi.apk` | **`cn.feiteng.fizzspace`** | 小米             | `android-cn` 沸腾繁星 key              |
| cn     | ios      | `cn-ios.ipa`    | `cn.fizzspaceapp`          | App Store (中国) | automatic, team `H5FAJB56F4`           |

> **CN Android is dual-package and must NOT be merged.** 华为 认证 is on
> `cn.fizzdragon`; 小米 软著 is bound to the legacy `cn.feiteng.fizzspace`. Both
> are signed with the same `android-cn` key. See `app/signing/README.md`.

## Prerequisites (one-time)

1. **Toolchain:** Xcode (+ CocoaPods), Android SDK (`~/Library/Android/sdk`), Node.
2. **Signing materials** — live OUTSIDE the repo in `app/signing/` (never
   git-tracked). Paths + passwords are documented in `app/signing/README.md`.
3. **`apps/mobile/.env.release.local`** — copy `.env.release.example` and fill in
   the keystore paths/passwords + iOS teams (gitignored).
4. **iOS CN** uses Xcode-managed automatic signing — sign into Xcode with the
   Boiling Stars account (`505421473@qq.com`); if Apple shows a pending Program
   License Agreement, the **account holder** must accept it (developer.apple.com)
   or `xcodebuild` export fails.

## Releasing a new version

1. Bump in `app.config.js`: `version` (e.g. `2.0.1`) and `ios.buildNumber` /
   `android.versionCode` (must be **higher than every build already uploaded** —
   App Store/Play/华为/小米 each reject a re-used build number).
2. `npm run build:release all all`
3. Upload each artifact to its store. For **iOS**, App Store Connect pulls the icon
   from the build; for **Android**, also upload a **512×512 PNG** app icon
   (generate from `assets/images/icon.png`: `sips -z 512 512 …`).

## How signing/config stays correct (the footguns this fixes)

- **Android signing survives prebuild.** `expo prebuild` regenerates
  `build.gradle` signing the release build with the _debug_ key. The
  `withAndroidReleaseSigning` config plugin re-injects the real release
  `signingConfig` (reading `FIZZDRAGON_UPLOAD_*` gradle props the script passes)
  on every prebuild. Never hand-patch `build.gradle`.
- **Region is exported to the whole build.** The script `export`s `FD_APP_REGION`
  (+ identifiers) so the JS-embed step also sees it — otherwise it defaults to
  `global` and a CN build ships the `.com` API config.
- **No root `.npmrc`.** A context-root `.npmrc` breaks `turbo prune` on service
  images; mobile builds use the default registry.

## Screenshots

- **iOS 6.9" (App Store):** iPhone 17 Pro Max simulator = 1320×2868. Run the app
  (`npx expo run:ios --configuration Release --device "iPhone 17 Pro Max"`),
  navigate, ⌘S (saves to Desktop).
- **Android 1080×1920 (小米/华为):** `flutter_emulator` AVD is 1080×1920. The
  release `.apk` installs directly (`adb install`); capture with
  `adb exec-out screencap -p`.
