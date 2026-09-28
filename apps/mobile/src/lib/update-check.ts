/**
 * In-app version update check. Compares the running build's versionCode
 * against the region's release manifest and prompts with a native alert:
 * "update" opens the announced download URL (direct APK on CN Android,
 * store page elsewhere).
 *
 * - Auto mode (app launch): silent on failure, throttled to once per day.
 * - Manual mode (settings row): always checks, reports "up to date" / errors.
 * - No-op on web and in dev launches (auto mode only) — there is no
 *   installable build to update.
 */
import Constants from "expo-constants";
import { Alert, Linking, Platform } from "react-native";

import { fetchLatestRelease } from "@/data/app-release-api";
import { t } from "@/i18n";
import { getStoredString, setStoredString } from "@/lib/persistent-storage";

const LAST_CHECK_KEY = "fizzdragon.updateCheck.lastAt";
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The running build's android versionCode / ios buildNumber. */
function currentBuildCode(): number | null {
  if (Platform.OS === "android") {
    return Constants.expoConfig?.android?.versionCode ?? null;
  }
  if (Platform.OS === "ios") {
    const code = Number(Constants.expoConfig?.ios?.buildNumber);
    return Number.isFinite(code) ? code : null;
  }
  return null;
}

function promptUpdate(
  versionName: string,
  notes: string | undefined,
  url: string,
  forced: boolean
) {
  const openUpdate = async () => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(t("update.openFailed"), error instanceof Error ? error.message : undefined);
    }
  };
  const buttons = forced
    ? [{ text: t("update.updateNow"), onPress: () => void openUpdate() }]
    : [
        { text: t("update.later"), style: "cancel" as const },
        { text: t("update.updateNow"), onPress: () => void openUpdate() },
      ];
  Alert.alert(
    `${t("update.availableTitle")} ${versionName}`,
    notes || t("update.availableDetail"),
    buttons,
    // A forced prompt re-surfaces on next launch anyway; cancelable:false just
    // stops the Android back button from silently dismissing it.
    { cancelable: !forced }
  );
}

export async function checkForUpdate({ manual = false } = {}): Promise<void> {
  if (Platform.OS === "web") return;
  if (__DEV__ && !manual) return;

  const current = currentBuildCode();
  if (current === null) return;

  // Always fetch, even on auto launches: we can't know whether an update is
  // FORCED (current < minSupportedCode) without the manifest, and a forced
  // prompt must re-surface every launch. The throttle below gates only the
  // dismissable prompt, never the network call.
  let release;
  try {
    release = await fetchLatestRelease();
  } catch {
    if (manual) Alert.alert(t("update.checkFailed"));
    return;
  }

  if (!release || release.versionCode <= current) {
    if (manual) Alert.alert(t("update.upToDate"));
    return;
  }

  const forced = release.minSupportedCode !== undefined && current < release.minSupportedCode;

  // Optional auto prompts are throttled to once/day so we don't nag on every
  // cold start; a forced update ignores the throttle and re-prompts until taken.
  if (!manual && !forced) {
    const last = Number(await getStoredString(LAST_CHECK_KEY).catch(() => null));
    if (Number.isFinite(last) && Date.now() - last < AUTO_CHECK_INTERVAL_MS) return;
  }
  if (!manual) void setStoredString(LAST_CHECK_KEY, String(Date.now())).catch(() => {});

  promptUpdate(release.versionName, release.releaseNotes, release.downloadUrl, forced);
}
