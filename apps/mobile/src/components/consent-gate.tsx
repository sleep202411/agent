import { useEffect, useState } from "react";
import { BackHandler, Modal, Platform, Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { hasPrivacyConsent, openLegal, setPrivacyConsent } from "@/lib/legal";

/**
 * First-launch privacy/terms consent gate (CN app-store requirement). Shows once
 * over the whole app until the user agrees; declining exits on Android. The
 * policy is also reachable later from Settings.
 */
export function ConsentGate() {
  const t = useTranslations();
  const locale = useLocale();
  const theme = useTheme();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void hasPrivacyConsent().then((ok) => setVisible(!ok));
  }, []);

  const agree = async () => {
    await setPrivacyConsent();
    setVisible(false);
  };

  const refuse = () => {
    if (Platform.OS === "android") BackHandler.exitApp();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={refuse}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="subtitle" style={styles.title}>
            {t("consent.title")}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.message}>
            {t("consent.message")}
          </ThemedText>

          <View style={styles.links}>
            <ThemedText
              style={[styles.link, { color: theme.brand }]}
              onPress={() => void openLegal("/terms-of-service", locale)}
            >
              {t("settings.terms")}
            </ThemedText>
            <ThemedText
              style={[styles.link, { color: theme.brand }]}
              onPress={() => void openLegal("/privacy-policy", locale)}
            >
              {t("settings.privacy")}
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={agree}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <View style={[styles.agree, { backgroundColor: theme.brand }]}>
              <ThemedText style={styles.agreeText}>{t("consent.agree")}</ThemedText>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={refuse}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <View style={styles.refuse}>
              <ThemedText themeColor="textSecondary">{t("consent.refuse")}</ThemedText>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    paddingHorizontal: Spacing.six,
  },
  card: { borderRadius: 16, padding: Spacing.six },
  title: { fontSize: 17, textAlign: "center", marginBottom: Spacing.three },
  message: { fontSize: 14, lineHeight: 22, textAlign: "center" },
  links: {
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.five,
    marginTop: Spacing.four,
  },
  link: { fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.8 },
  agree: {
    marginTop: Spacing.six,
    paddingVertical: Spacing.four,
    borderRadius: 999,
    alignItems: "center",
  },
  agreeText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  refuse: { marginTop: Spacing.two, paddingVertical: Spacing.three, alignItems: "center" },
});
