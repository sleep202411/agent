import { useCallback, useEffect, useRef, useState } from "react";
import * as WebBrowser from "expo-web-browser";
import { webBaseUrl } from "@/config";
import { Stack, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { openLegal } from "@/lib/legal";
import { checkForUpdate } from "@/lib/update-check";

export default function SettingsScreen() {
  const t = useTranslations();
  const locale = useLocale();
  const theme = useTheme();
  const router = useRouter();
  const authGate = useAuthGate();
  const mounted = useRef(false);
  const opening = useRef(false);
  const [linkError, setLinkError] = useState<string>();
  const [openingLink, setOpeningLink] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const handleOpenPage = useCallback(
    (path: string) => {
      if (opening.current) return;
      opening.current = true;
      setOpeningLink(true);
      setLinkError(undefined);
      void (async () => {
        try {
          if (path === "/faq") await WebBrowser.openBrowserAsync(`${webBaseUrl}/${locale}/faq`);
          else await openLegal(path, locale);
        } catch (cause) {
          if (mounted.current)
            setLinkError(cause instanceof Error ? cause.message : t("settings.openFailed"));
        } finally {
          opening.current = false;
          if (mounted.current) setOpeningLink(false);
        }
      })();
    },
    [t, locale]
  );

  const rows: {
    key: string;
    label: string;
    onPress?: () => void;
    danger?: boolean;
    publicPage?: string;
  }[] = [
    {
      key: "accountSecurity",
      label: t("settings.accountSecurity"),
      onPress: () =>
        authGate.requireAuth({ onAuthenticated: () => router.push("/account-security") }),
    },
    {
      key: "creditRewards",
      label: t("creditRewards.title"),
      onPress: () =>
        authGate.requireAuth({ onAuthenticated: () => router.push("/credit-rewards") }),
    },
    {
      key: "bindInvite",
      label: t("settings.bindInvite"),
      onPress: () => authGate.requireAuth({ onAuthenticated: () => router.push("/bind-invite") }),
    },
    {
      key: "privacy",
      label: t("settings.privacy"),
      publicPage: "/privacy-policy",
    },
    {
      key: "terms",
      label: t("settings.terms"),
      publicPage: "/terms-of-service",
    },
    {
      key: "refund",
      label: t("settings.refund"),
      publicPage: "/refund-policy",
    },
    {
      key: "faq",
      label: t("settings.faq"),
      publicPage: "/faq",
    },
    {
      key: "checkUpdate",
      label: t("settings.checkUpdate"),
      onPress: () => void checkForUpdate({ manual: true }),
    },
    {
      key: "about",
      label: t("settings.about"),
      onPress: () => router.push("/about"),
    },
    {
      key: "delete",
      label: t("settings.deleteAccount"),
      danger: true,
      onPress: () =>
        authGate.requireAuth({ onAuthenticated: () => router.push("/delete-account") }),
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("settings.title"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      <ScrollView contentContainerStyle={styles.list}>
        {linkError && <ThemedText accessibilityRole="alert">{linkError}</ThemedText>}
        {rows.map((row) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            onPress={() => (row.publicPage ? handleOpenPage(row.publicPage) : row.onPress?.())}
            disabled={!!row.publicPage && openingLink}
            accessibilityState={{ disabled: !!row.publicPage && openingLink }}
            style={({ pressed }) =>
              pressed || (row.publicPage && openingLink) ? styles.pressed : null
            }
          >
            <View style={[styles.row, { borderBottomColor: theme.border }]}>
              <ThemedText style={[styles.label, row.danger ? { color: theme.brand } : null]}>
                {row.label}
              </ThemedText>
              <SymbolView
                name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
                size={15}
                tintColor={theme.textSecondary}
              />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  pressed: { opacity: 0.6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.four,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 16 },
});
