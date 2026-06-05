import { NativeTabs } from "expo-router/unstable-native-tabs";

import { Colors } from "@/constants/theme";

export default function AppTabs() {
  const colors = Colors.dark;

  return (
    <NativeTabs
      backgroundColor={colors.background}
      tintColor={colors.brand}
      disableTransparentOnScrollEdge
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.brand } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>IP</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "movie", selected: "movie" }}
          sf={{ default: "film.stack", selected: "film.stack.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="crews">
        <NativeTabs.Trigger.Label>Crews</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "group", selected: "group" }}
          sf={{ default: "person.2", selected: "person.2.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="news">
        <NativeTabs.Trigger.Label>News</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "feed", selected: "feed" }}
          sf={{ default: "newspaper", selected: "newspaper.fill" }}
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="mine">
        <NativeTabs.Trigger.Label>Mine</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          md={{ default: "person", selected: "person" }}
          sf={{ default: "person", selected: "person.fill" }}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
