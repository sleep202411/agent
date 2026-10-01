import Constants from "expo-constants";
import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isChinaRegion } from "@/config";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

const LOGO = require("@/assets/images/fizzdragon-logo.png");
const COPYRIGHT_YEAR = 2026;
const COMPANY_CN = "沸腾繁星（苏州）数字科技有限公司";
const COMPANY_GLOBAL = "FizzDragon Pte Ltd";

function versionLabel(): string {
  const version = Constants.expoConfig?.version?.trim() || "—";
  return `Version ${version}`;
}

export default function AboutScreen() {
  const t = useTranslations();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const company = isChinaRegion ? COMPANY_CN : COMPANY_GLOBAL;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("about.title"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />

      <View style={styles.body}>
        <View style={styles.hero}>
          <Image source={LOGO} style={styles.logo} contentFit="contain" />
          <ThemedText type="small" themeColor="textSecondary" style={styles.version}>
            {versionLabel()}
          </ThemedText>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/certificate-verify")}
          style={{ paddingVertical: Spacing.three }}
        >
          <ThemedText type="small">{t("certificateVerification.toolTitle")}</ThemedText>
        </Pressable>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.five) }]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.footerLine}>
            {`Copyright©${COPYRIGHT_YEAR}`}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.footerLine}>
            {company}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
  },
  hero: {
    alignItems: "center",
    paddingTop: Spacing.eight,
    gap: Spacing.three,
  },
  logo: {
    width: 96,
    height: 96,
  },
  version: {
    textAlign: "center",
  },
  footer: {
    alignItems: "center",
    gap: Spacing.one,
    paddingTop: Spacing.four,
  },
  footerLine: {
    textAlign: "center",
  },
});
