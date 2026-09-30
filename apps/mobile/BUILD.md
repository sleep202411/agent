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

| region | platform | variant                | identifier             | store            | signing                                |
| ------ | -------- | ---------------------- | ---------------------- | ---------------- | -------------------------------------- |
| global | android  | `global.aab`           | `com.fizzdragon`       | Google Play      | `android-global-googleplay` upload key |
| global | android  | `global-transsion.apk` | `com.fizzdragon`       | 传音 PalmStore   | same Google Play upload key            |
| global | ios      | `global.ipa`           | `com.fizzdragon.app`   | App Store (intl) | manual, team `273BAZ5UTL` + profile    |
| cn     | android  | `cn.apk`               | `cn.feiteng.fizzspace` | 华为 + 小米      | `android-cn` 沸腾繁星 key              |
| cn     | ios      | `cn-ios.ipa`           | `cn.fizzspaceapp`      | App Store (中国) | automatic, team `H5FAJB56F4`           |

> **Global Android emits both formats from one prebuild:** `.aab` for Play and
> `.apk` for Transsion (and any other APK-only store). Same package + keystore.
>
> **CN Android is one package.** 华为 and 小米 listings are both
> `cn.feiteng.fizzspace`, signed with the same `android-cn` key. Upload the
> same APK to both stores. Do not ship `cn.fizzdragon` — that identifier is
> retired. See `app/signing/README.md`.

## Prerequisites (one-time)

1. **Toolchain:** Xcode (+ CocoaPods), Android SDK (`~/Library/Android/sdk`), Node.
2. **Signing materials** — live OUTSIDE the repo in `app/signing/` (never
   git-tracked). Paths + passwords are documented in `app/signing/README.md`.
3. **`apps/mobile/env.release.local`** — copy `env.release.example` and fill in
   the keystore paths/passwords + iOS teams (gitignored; not named `.env*` so
   Expo Metro does not bundle it).
4. **iOS CN** uses Xcode-managed automatic signing — sign into Xcode with the
   Boiling Stars account (`505421473@qq.com`); if Apple shows a pending Program
   License Agreement, the **account holder** must accept it (developer.apple.com)
   or `xcodebuild` export fails.

## Releasing a new version

1. Bump in `app.config.js`: `version` (e.g. `2.0.1`) and `ios.buildNumber` /
   `android.versionCode` (must be **higher than every build already uploaded** —
   App Store/Play/传音/华为/小米 each reject a re-used build number).
2. `npm run build:release all all`
   - Global Android only: `npm run build:release -- global android` → Desktop gets
     both `…-global.aab` (Play) and `…-global-transsion.apk` (传音).
   - Cloud APK (传音, same signing as local once EAS credentials match):  
     `npx eas-cli build --profile production-global-apk --platform android`
   - Cloud CN APK (华为 + 小米, same package):  
     `npx eas-cli build --profile production-cn --platform android`
3. Upload each artifact to its store. For **iOS**, App Store Connect pulls the icon
   from the build; for **Android**, also upload a **512×512 PNG** app icon
   (generate from `assets/images/icon.png`: `sips -z 512 512 …`).

## Native pay SDKs (RevenueCat / WeChat)

`react-native-purchases` and `expo-wechat` are native
modules. Metro JS updates do not pick them up — rebuild the binary after
install or plugin changes:

- CN and global iOS (RevenueCat): `npx eas-cli build --profile development-cn --platform ios` or `development-global`
- Google Play (RevenueCat): `npx eas-cli build --profile development-global --platform android`
- CN Android WeChat: `npx eas-cli build --profile development-cn --platform android`

CN iOS and global iOS both purchase through RevenueCat (`react-native-purchases`).
Google Play does too. CN Android WeChat is Native scan pay: the app calls Nest
`/billing/checkout` and renders the `weixin://` code as a QR. It does not use
WeChat H5 or the OpenSDK `pay()` path, so `EXPO_PUBLIC_WECHAT_APP_ID` is not
required for checkout. Bake `EXPO_PUBLIC_REVENUECAT_*` for every store build;
never put RevenueCat secrets or WeChat merchant certs in the app.

**WeChat Universal Links (CN iOS):** Web hosts AASA + `/app/` on
`fizzdragon.fizzspace.cn`. Mobile bakes
`EXPO_PUBLIC_WECHAT_UNIVERSAL_LINK=https://fizzdragon.fizzspace.cn/app/` so
`associatedDomains` includes `applinks:fizzdragon.fizzspace.cn` and
`expo-wechat` `registerApp` gets the same URL. Rebuild the CN iOS binary after
changing this; OTA is not enough. AASA must list Bundle ID `cn.fizzspaceapp`.

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
