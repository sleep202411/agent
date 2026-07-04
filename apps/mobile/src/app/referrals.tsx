/**
 * 邀请奖励 — a thin AuthedWebView over the apps/web /referral dashboard.
 *
 * The page (and all its reward copy) is server-owned: the typed reward
 * ladder renders from the backend, so the old native screen's hardcoded
 * cash narrative can never drift again, and reward changes ship without
 * an app release. Guests keep the native sign-in prompt.
 */
import { Stack } from "expo-router";
import { SymbolView } from "expo-symbols";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { useAuth, useAuthGate } from "@/auth";
import { AuthedWebView } from "@/components/authed-web-view";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function ReferralsScreen() {
  const auth = useAuth();
  const authGate = useAuthGate();
  const t = useTranslations();
  const theme = useTheme();

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        headerTitle: t("referrals.title"),
        headerBackButtonDisplayMode: "minimal",
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
      }}
    />
  );

  if (auth.status === "hydrating") {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        {header}
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  if (auth.status !== "authenticated") {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        {header}
        <View style={[styles.centerIcon, { backgroundColor: theme.backgroundElement }]}>
          <SymbolView
            name={{ ios: "gift", android: "redeem", web: "redeem" }}
            size={34}
            tintColor={theme.textSecondary}
          />
        </View>
        <ThemedText type="subtitle" style={styles.centerTitle}>
          {t("referrals.guestTitle")}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.centerBody}>
          {t("referrals.guestBody")}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => authGate.openLogin()}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.brand },
            pressed && styles.pressed,
          ]}
        >
          <ThemedText type="smallBold" style={styles.primaryButtonText}>
            {t("login.signIn")}
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return <AuthedWebView path="/referral" title={t("referrals.title")} />;
}

const styles = StyleSheet.create({
  centered: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing.six,
  },
  centerIcon: {
    alignItems: "center",
    borderRadius: 999,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  centerTitle: {
    marginTop: Spacing.four,
    textAlign: "center",
  },
  centerBody: {
    marginTop: Spacing.two,
    textAlign: "center",
  },
  primaryButton: {
    borderRadius: 999,
    marginTop: Spacing.five,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
  },
  primaryButtonText: {
    color: "#FFFFFF",
  },
  pressed: {
    opacity: 0.85,
  },
});
