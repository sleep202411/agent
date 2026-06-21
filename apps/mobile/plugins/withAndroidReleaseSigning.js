/**
 * Expo config plugin: inject the Android RELEASE signing config into
 * `android/app/build.gradle` during prebuild.
 *
 * Why this exists: `expo prebuild` regenerates `build.gradle` from the default
 * template, which signs the `release` buildType with the DEBUG key. Without this
 * plugin every prebuild silently reverts release signing to debug — and a
 * debug-signed AAB/APK is rejected by every store ("签名不一致" / wrong upload
 * cert). This plugin re-applies, on every prebuild, a `release` signingConfig
 * that reads the keystore from gradle properties:
 *
 *   FIZZDRAGON_UPLOAD_STORE_FILE / _STORE_PASSWORD / _KEY_ALIAS / _KEY_PASSWORD
 *
 * Those are supplied per-region at build time (scripts/build-release.sh passes
 * them via -P from the gitignored signing env) so no secret lives in the repo.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const DEBUG_BLOCK = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
`;

const RELEASE_BLOCK = `        release {
            if (project.hasProperty('FIZZDRAGON_UPLOAD_STORE_FILE')) {
                storeFile file(FIZZDRAGON_UPLOAD_STORE_FILE)
                storePassword FIZZDRAGON_UPLOAD_STORE_PASSWORD
                keyAlias FIZZDRAGON_UPLOAD_KEY_ALIAS
                keyPassword FIZZDRAGON_UPLOAD_KEY_PASSWORD
            }
        }
`;

const TEMPLATE_RELEASE_BUILDTYPE = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const PATCHED_RELEASE_BUILDTYPE = `        release {
            signingConfig signingConfigs.release`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes('FIZZDRAGON_UPLOAD_STORE_FILE')) return cfg; // already applied

    if (!src.includes(DEBUG_BLOCK)) {
      throw new Error(
        '[withAndroidReleaseSigning] expected debug signingConfig block not found — ' +
          'the Expo template changed; update plugins/withAndroidReleaseSigning.js',
      );
    }
    src = src.replace(DEBUG_BLOCK, DEBUG_BLOCK + RELEASE_BLOCK);

    if (!src.includes(TEMPLATE_RELEASE_BUILDTYPE)) {
      throw new Error(
        '[withAndroidReleaseSigning] expected release buildType (signingConfigs.debug) not found — ' +
          'the Expo template changed; update plugins/withAndroidReleaseSigning.js',
      );
    }
    src = src.replace(TEMPLATE_RELEASE_BUILDTYPE, PATCHED_RELEASE_BUILDTYPE);

    cfg.modResults.contents = src;
    return cfg;
  });
};
