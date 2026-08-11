import { StyleSheet } from "react-native";

import { useAuth } from "@/auth";
import AppTabs from "@/components/app-tabs";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTabsRemountKey } from "@/hooks/use-screen-orientation";
import { useTranslations } from "@/i18n";

export default function TabLayout() {
  const auth = useAuth();
  const t = useTranslations();
  // Remount after landscape play exit — NativeTabs keeps a stale landscape
  // native layout if we only pop back onto the frozen screen.
  const tabsRemountKey = useTabsRemountKey();

  // Guest-first: the tab shell is browsable while signed out. Only block on the
  // brief hydrate so we don't flash a signed-out state over a restored session;
  // sign-in is deferred to the actions that actually need it.
  if (auth.status === "hydrating") {
    return (
      <ThemedView style={styles.loadingScreen}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t("tabs.loadingWorkspace")}
        </ThemedText>
      </ThemedView>
    );
  }

  return <AppTabs key={tabsRemountKey} />;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
});
