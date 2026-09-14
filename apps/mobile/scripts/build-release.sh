#!/usr/bin/env bash
# ============================================================================
# FizzDragon mobile — one-command production release builds.
#
#   ./scripts/build-release.sh <region> <platform>
#     region   = global | cn | all
#     platform = ios | android | all
#
# Produces signed, store-ready artifacts in $FD_OUT_DIR named
#   FizzDragon-<version>-<build>-<variant>.{aab,apk,ipa}
# where variant ∈ {global, global-transsion, cn, cn-ios}.
#
# Signing secrets + material paths come from a GITIGNORED env file
# (apps/mobile/env.release.local — see env.release.example). Named without the
# leading `.env` so Expo Metro does not treat it as a dotenv module. No secret
# lives in the repo. Android release signing is injected by the
# `withAndroidReleaseSigning` config plugin during prebuild (so the keystore is
# wired via FIZZDRAGON_UPLOAD_* gradle props, passed below per region).
#
# Version + build number come from app.config.js (single source of truth).
# CN Android is one package: 华为 + 小米 = cn.feiteng.fizzspace (eas.json
# production-cn). cn.fizzdragon is retired. Global Android produces BOTH
# Google Play (.aab) and Transsion PalmStore (.apk) from one prebuild
# (same package + upload keystore).
# ============================================================================
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MOBILE_DIR"

# ── load signing/material config (gitignored) ──
ENV_FILE="${FD_RELEASE_ENV:-$MOBILE_DIR/env.release.local}"
[ -f "$ENV_FILE" ] || {
  echo "FATAL: $ENV_FILE not found. Copy env.release.example to env.release.local and fill it in." >&2
  exit 1
}
set -a; # shellcheck disable=SC1090
source "$ENV_FILE"; set +a

: "${FD_OUT_DIR:?set FD_OUT_DIR}"
export ANDROID_HOME="${FD_ANDROID_SDK:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
mkdir -p "$FD_OUT_DIR"

# ── monorepo hoisting guard ──
# `expo` (and its bundled @expo/cli → @expo/router-server) hoists to the repo
# root node_modules, but expo-router installs only under apps/mobile. During
# `expo export:embed` (the gradle/xcode JS-bundle step) @expo/router-server does
# a raw Node `require('expo-router/internal/routing')` from the root, which then
# can't resolve expo-router → "Cannot find module" → the bundle step dies.
# (`expo export` is unaffected: Metro resolves from the project root.) Symlink
# expo-router at the repo root so that bare require resolves.
ROOT_NM="$(cd "$MOBILE_DIR/../.." && pwd)/node_modules"
if [ -d "$ROOT_NM" ] && [ ! -e "$ROOT_NM/expo-router" ]; then
  ln -s ../apps/mobile/node_modules/expo-router "$ROOT_NM/expo-router"
  echo "  [hoisting-guard] symlinked expo-router at repo root"
fi

REGION="${1:?usage: build-release.sh <global|cn|all> <ios|android|all>}"
PLATFORM="${2:?usage: build-release.sh <global|cn|all> <ios|android|all>}"

VER="$(node -p "require('./app.config.js')({config:{}}).version")"
BUILD="$(node -p "require('./app.config.js')({config:{}}).ios.buildNumber")"
echo "==> FizzDragon $VER (build $BUILD) — region=$REGION platform=$PLATFORM"

APKSIGNER="$(ls "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)"
RESULT=""

# prebuild for a region/platform with the full identifier env exported so the
# JS-embed step (which re-reads app.config) also sees the region — else it
# defaults to global and the app ships the wrong (.com) API config.
prebuild() { # region platform androidPackage
  local region="$1" platform="$2" pkg="$3"
  export APP_VARIANT=production FD_APP_REGION="$region"
  export FD_GLOBAL_IOS_BUNDLE_IDENTIFIER="${FD_GLOBAL_IOS_BUNDLE_IDENTIFIER:-com.fizzdragon.app}"
  export FD_GLOBAL_ANDROID_PACKAGE="${FD_GLOBAL_ANDROID_PACKAGE:-com.fizzdragon}"
  export FD_CN_IOS_BUNDLE_IDENTIFIER="${FD_CN_IOS_BUNDLE_IDENTIFIER:-cn.fizzspaceapp}"
  [ "$region" = cn ] && export FD_CN_ANDROID_PACKAGE="$pkg" || export FD_GLOBAL_ANDROID_PACKAGE="$pkg"
  echo "  [$(date +%T)] prebuild $region/$platform pkg=$pkg"
  npx expo prebuild --platform "$platform" --clean --no-install >/tmp/fd-prebuild-$region-$platform.log 2>&1
}

# Run a gradle release task against an already-prebuilt android/ tree and copy
# the artifact. Used after a single prebuild to emit both .aab and .apk.
gradle_release() { # variant package keystore storepass alias keypass task ext gradleOut
  local variant="$1" pkg="$2" ks="$3" sp="$4" al="$5" kp="$6" task="$7" ext="$8" gout="$9"
  echo "  [$(date +%T)] gradlew $task ($variant)"
  ( cd android && ./gradlew "$task" --no-daemon \
      -PFIZZDRAGON_UPLOAD_STORE_FILE="$ks" -PFIZZDRAGON_UPLOAD_STORE_PASSWORD="$sp" \
      -PFIZZDRAGON_UPLOAD_KEY_ALIAS="$al" -PFIZZDRAGON_UPLOAD_KEY_PASSWORD="$kp" \
    ) >/tmp/fd-gradle-$variant.log 2>&1
  local out="$FD_OUT_DIR/FizzDragon-$VER-$BUILD-$variant.$ext"
  cp "android/$gout" "$out"
  local md5; md5="$("$APKSIGNER" verify --print-certs "$out" 2>/dev/null | grep -i 'MD5' | grep -oE '[a-f0-9]{32}' || echo '?')"
  RESULT="$RESULT\n  ✓ $variant ($pkg) sig=$md5 → $(basename "$out")"
}

build_android() { # variant region package keystore storepass alias keypass task ext gradleOut
  local variant="$1" region="$2" pkg="$3" ks="$4" sp="$5" al="$6" kp="$7" task="$8" ext="$9" gout="${10}"
  prebuild "$region" android "$pkg"
  gradle_release "$variant" "$pkg" "$ks" "$sp" "$al" "$kp" "$task" "$ext" "$gout"
}

build_ios() { # variant region bundleId signStyle team profileOrEmpty
  local variant="$1" region="$2" bundle="$3" style="$4" team="$5" profile="${6:-}"
  prebuild "$region" ios "$bundle"   # pkg arg unused for ios but harmless
  echo "  [$(date +%T)] pod install ($variant)"
  ( cd ios && pod install ) >/tmp/fd-pod-$variant.log 2>&1
  local arch="/tmp/FizzDragon-$variant.xcarchive"
  echo "  [$(date +%T)] xcodebuild archive ($variant, $style)"
  local signArgs=(CODE_SIGN_STYLE="$style" DEVELOPMENT_TEAM="$team")
  [ "$style" = Manual ] && signArgs+=(PROVISIONING_PROFILE_SPECIFIER="$profile" "CODE_SIGN_IDENTITY=Apple Distribution")
  xcodebuild -workspace ios/FizzDragon.xcworkspace -scheme FizzDragon -configuration Release \
    -archivePath "$arch" -destination 'generic/platform=iOS' archive \
    -allowProvisioningUpdates "${signArgs[@]}" >/tmp/fd-xcarchive-$variant.log 2>&1
  local plist="/tmp/fd-export-$variant.plist"
  if [ "$style" = Manual ]; then
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>teamID</key><string>$team</string>
<key>signingStyle</key><string>manual</string>
<key>provisioningProfiles</key><dict><key>$bundle</key><string>$profile</string></dict>
<key>signingCertificate</key><string>Apple Distribution</string>
<key>uploadSymbols</key><true/>
</dict></plist>
PLIST
  else
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>teamID</key><string>$team</string>
<key>signingStyle</key><string>automatic</string>
<key>uploadSymbols</key><true/>
</dict></plist>
PLIST
  fi
  echo "  [$(date +%T)] export ipa ($variant)"
  xcodebuild -exportArchive -archivePath "$arch" -exportPath "/tmp/fd-ipa-$variant" \
    -exportOptionsPlist "$plist" -allowProvisioningUpdates >/tmp/fd-xcexport-$variant.log 2>&1
  local out="$FD_OUT_DIR/FizzDragon-$VER-$BUILD-$variant.ipa"
  cp /tmp/fd-ipa-$variant/*.ipa "$out"
  RESULT="$RESULT\n  ✓ $variant ($bundle) → $(basename "$out")"
}

run_global_android() {
  local pkg="${FD_GLOBAL_ANDROID_PACKAGE:-com.fizzdragon}"
  local ks="$FD_GP_KEYSTORE" sp="$FD_GP_STORE_PASS" al="$FD_GP_KEY_ALIAS" kp="$FD_GP_KEY_PASS"
  # One clean prebuild, then both store formats (Play wants AAB; Transsion wants APK).
  prebuild global android "$pkg"
  gradle_release global            "$pkg" "$ks" "$sp" "$al" "$kp" bundleRelease   aab app/build/outputs/bundle/release/app-release.aab
  gradle_release global-transsion  "$pkg" "$ks" "$sp" "$al" "$kp" assembleRelease apk app/build/outputs/apk/release/app-release.apk
}
run_cn_android() {
  local pkg="${FD_CN_ANDROID_PACKAGE:-${FD_CN_XIAOMI_PACKAGE:-cn.feiteng.fizzspace}}"
  build_android cn cn "$pkg" "$FD_CN_KEYSTORE" "$FD_CN_STORE_PASS" "$FD_CN_KEY_ALIAS" "$FD_CN_KEY_PASS" assembleRelease apk app/build/outputs/apk/release/app-release.apk
}
run_global_ios() { build_ios global  global "${FD_GLOBAL_IOS_BUNDLE_IDENTIFIER:-com.fizzdragon.app}" Manual    "$FD_IOS_GLOBAL_TEAM" "$FD_IOS_GLOBAL_PROFILE"; }
run_cn_ios()     { build_ios cn-ios  cn     "${FD_CN_IOS_BUNDLE_IDENTIFIER:-cn.fizzspaceapp}"        Automatic "$FD_IOS_CN_TEAM"; }

want() { [ "$REGION" = all ] || [ "$REGION" = "$1" ]; }
wantp() { [ "$PLATFORM" = all ] || [ "$PLATFORM" = "$1" ]; }

want global && wantp android && run_global_android
want global && wantp ios     && run_global_ios
want cn     && wantp android && run_cn_android
want cn     && wantp ios     && run_cn_ios

echo -e "\n==> DONE @ $(date +%T):$RESULT"
echo "    output: $FD_OUT_DIR"
