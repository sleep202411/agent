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
        <NativeTabs.Trigger.Label>{t("tabs.home")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "home", selected: "home" }}
          sf={{ default: "house", selected: "house.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="creators">
        <NativeTabs.Trigger.Label>{t("tabs.creators")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "person", selected: "person" }}
          sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="crews">
        <NativeTabs.Trigger.Label>{t("tabs.crews")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "groups", selected: "groups" }}
          sf={{ default: "person.3", selected: "person.3.fill" }}
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
