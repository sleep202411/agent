import { SymbolView } from "expo-symbols";
import type { Href } from "expo-router";
import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps } from "expo-router/ui";
import { Pressable, StyleSheet } from "react-native";

import { ThemedText } from "./themed-text";
import { ThemedView } from "./themed-view";

import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

const tabItems = [
  {
    href: "/(tabs)",
    labelKey: "tabs.ip",
    name: "index",
    symbol: { ios: "film.stack", android: "movie", web: "movie" },
  },
  {
    href: "/crews",
    labelKey: "tabs.crews",
    name: "crews",
    symbol: { ios: "person.2", android: "group", web: "group" },
  },
  {
    href: "/news",
    labelKey: "tabs.news",
    name: "news",
    symbol: { ios: "newspaper", android: "feed", web: "feed" },
  },
  {
    href: "/mine",
    labelKey: "tabs.mine",
    name: "mine",
    symbol: { ios: "person", android: "person", web: "person" },
  },
] as const;

export default function AppTabs() {
  const t = useTranslations();

  return (
    <Tabs style={styles.shell}>
      <TabSlot style={styles.slot} />
      <TabList style={styles.tabList}>
        {tabItems.map((item) => (
          <TabTrigger key={item.name} name={item.name} href={item.href as Href} asChild>
            <TabButton symbol={item.symbol}>{t(item.labelKey)}</TabButton>
          </TabTrigger>
        ))}
      </TabList>
    </Tabs>
  );
}

export function TabButton({
  children,
  isFocused,
  symbol,
  ...props
}: TabTriggerSlotProps & { symbol: (typeof tabItems)[number]["symbol"] }) {
  const theme = useTheme();
  const color = isFocused ? theme.brand : theme.textSecondary;

  return (
    <Pressable {...props} style={({ pressed }) => [styles.tabPressable, pressed && styles.pressed]}>
      <ThemedView
        type={isFocused ? "backgroundSelected" : "backgroundElement"}
        style={styles.tabButtonView}
      >
        <SymbolView name={symbol} size={18} tintColor={color} />
        <ThemedText type="code" style={{ color }} numberOfLines={1}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    alignItems: "center",
  },
  slot: {
    width: "100%",
    flex: 1,
  },
  tabList: {
    position: "absolute",
    bottom: Spacing.four,
    width: "100%",
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "center",
  },
  tabPressable: {
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    minHeight: 54,
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.half,
  },
});
