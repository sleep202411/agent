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

function promptUpdate(versionName: string, notes: string | undefined, url: string) {
  const openUpdate = async () => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(t("update.openFailed"), error instanceof Error ? error.message : undefined);
    }
  };
  const buttons = [
    { text: t("update.later"), style: "cancel" as const },
    { text: t("update.updateNow"), onPress: () => void openUpdate() },
  ];
  Alert.alert(
    `${t("update.availableTitle")} ${versionName}`,
    notes || t("update.availableDetail"),
    buttons,
    { cancelable: true }
  );
}

export async function checkForUpdate({ manual = false } = {}): Promise<void> {
  if (Platform.OS === "web") return;
  if (__DEV__ && !manual) return;

  const current = currentBuildCode();
  if (current === null) return;

  // Mobile updates remain optional, including when the manifest advertises
  // a higher minimum build. Only an explicit user action opens the update URL.
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

  // Automatic prompts are limited to once per day; manual checks bypass this.
  if (!manual) {
    const last = Number(await getStoredString(LAST_CHECK_KEY).catch(() => null));
    if (Number.isFinite(last) && Date.now() - last < AUTO_CHECK_INTERVAL_MS) return;
  }
  if (!manual) void setStoredString(LAST_CHECK_KEY, String(Date.now())).catch(() => {});

  promptUpdate(release.versionName, release.releaseNotes, release.downloadUrl);
}
