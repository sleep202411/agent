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
        <NativeTabs.Trigger.Label>{t("tabs.ip")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "movie", selected: "movie" }}
          sf={{ default: "film.stack", selected: "film.stack.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="crews">
        <NativeTabs.Trigger.Label>{t("tabs.crews")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "group", selected: "group" }}
          sf={{ default: "person.2", selected: "person.2.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="news">
        <NativeTabs.Trigger.Label>{t("tabs.news")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "feed", selected: "feed" }}
          sf={{ default: "newspaper", selected: "newspaper.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="mine">
        <NativeTabs.Trigger.Label>{t("tabs.mine")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "person", selected: "person" }}
          sf={{ default: "person", selected: "person.fill" }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
