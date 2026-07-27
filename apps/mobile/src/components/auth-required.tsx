/**
 * Guest gate for login-only screens — icon + copy + a sign-in button that opens
 * the global auth bottom sheet (and a register link). Drop this in wherever a
 * read requires a Java session (e.g. the talent list 302s for guests).
 */
import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export function AuthRequired({
  title,
  body,
  icon = { ios: "person.crop.circle", android: "person", web: "person" },
}: {
  title: string;
  body: string;
  icon?: ComponentProps<typeof SymbolView>["name"];
}) {
  const authGate = useAuthGate();
  const t = useTranslations();
  const theme = useTheme();

  return (
    <View style={styles.root}>
      <View style={[styles.iconWrap, { backgroundColor: theme.backgroundElement }]}>
        <SymbolView name={icon} size={36} tintColor={theme.textSecondary} />
      </View>
      <View style={styles.copy}>
        <ThemedText type="subtitle" style={styles.center}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {body}
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => authGate.openLogin()}
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: theme.brand },
          pressed && styles.pressed,
        ]}
      >
        <ThemedText type="smallBold" style={styles.primaryText}>
          {t("auth.continue")}
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    gap: Spacing.four,
    paddingHorizontal: Spacing.six,
    paddingTop: Spacing.eight,
  },
  iconWrap: {
    alignItems: "center",
    borderRadius: 999,
    height: 88,
    justifyContent: "center",
    width: 88,
  },
  copy: {
    alignItems: "center",
    gap: Spacing.two,
  },
  center: {
    textAlign: "center",
  },
  primary: {
    alignItems: "center",
    borderRadius: 12,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.eight,
    paddingVertical: Spacing.three,
  },
  primaryText: {
    color: "#FFFFFF",
  },
  pressed: {
    opacity: 0.72,
  },
});
