import { Tabs, TabList, TabTrigger, TabSlot, TabTriggerSlotProps } from "expo-router/ui";
import { Pressable, StyleSheet, View } from "react-native";

import { AppIcon, type AppIconName } from "./app-icon";
import { appTabItems } from "./app-tab-items";
import { ThemedText } from "./themed-text";

import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function AppTabs() {
  const t = useTranslations();
  const theme = useTheme();

  return (
    <Tabs style={styles.shell}>
      <TabSlot style={styles.slot} />
      <TabList
        style={[
          styles.tabList,
          {
            borderColor: theme.border,
            backgroundColor: theme.backgroundElement,
          },
        ]}
      >
        {appTabItems.map((item) => (
          <TabTrigger key={item.name} name={item.name} href={item.href} asChild>
            <TabButton icon={item.icon}>{t(item.labelKey)}</TabButton>
          </TabTrigger>
        ))}
      </TabList>
    </Tabs>
  );
}

export function TabButton({
  children,
  icon,
  isFocused,
  ...props
}: TabTriggerSlotProps & { icon: AppIconName }) {
  const theme = useTheme();
  const color = isFocused ? theme.brand : theme.textSecondary;

  return (
    <Pressable {...props} style={({ pressed }) => [styles.tabPressable, pressed && styles.pressed]}>
      <View
        style={[
          styles.tabButtonView,
          isFocused && {
            backgroundColor: theme.backgroundSelected,
          },
        ]}
      >
        <AppIcon name={icon} size={22} color={color} strokeWidth={isFocused ? 2.4 : 2} />
        <ThemedText type="code" style={{ color }} numberOfLines={1}>
          {children}
        </ThemedText>
      </View>
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
    left: Spacing.four,
    right: Spacing.four,
    padding: Spacing.one,
    flexDirection: "row",
    gap: Spacing.one,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
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
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.half,
  },
});
