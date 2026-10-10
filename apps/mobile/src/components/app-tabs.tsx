import { NativeTabs } from "expo-router/unstable-native-tabs";

import { Colors } from "@/constants/theme";
import { useTranslations } from "@/i18n";

export default function AppTabs() {
  const colors = Colors.dark;
  // Reactive translator so the native tab labels update on language switch.
  const t = useTranslations();

  return (
    <NativeTabs
      backgroundColor={colors.background}
      tintColor={colors.brand}
      disableTransparentOnScrollEdge
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.brand } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label hidden>{t("tabs.home")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require("@/assets/images/tab-icons/tab-home.png")}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="creators">
        <NativeTabs.Trigger.Label hidden>{t("tabs.creators")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require("@/assets/images/tab-icons/tab-creators.png")}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="crews">
        <NativeTabs.Trigger.Label hidden>{t("tabs.crews")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require("@/assets/images/tab-icons/tab-crews.png")}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="courses">
        <NativeTabs.Trigger.Label hidden>{t("tabs.courses")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require("@/assets/images/tab-icons/tab-news.png")}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="mine">
        <NativeTabs.Trigger.Label hidden>{t("tabs.mine")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require("@/assets/images/tab-icons/tab-mine.png")}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
