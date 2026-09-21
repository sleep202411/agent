import { useEffect, useState } from "react";
import {
  Alert,
  BackHandler,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { hasPrivacyConsent, openLegal, setPrivacyConsent } from "@/lib/legal";

const webFocusReset =
  Platform.OS === "web"
    ? ({
        outlineColor: "transparent",
        outlineStyle: "none",
        outlineWidth: 0,
      } as unknown as ViewStyle)
    : null;

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
    let active = true;
    void hasPrivacyConsent().then(
      (ok) => {
        if (active) setVisible(!ok);
      },
      () => {
        if (active) setVisible(true);
      }
    );
    return () => {
      active = false;
    };
  }, []);

  const agree = async () => {
    try {
      await setPrivacyConsent();
      setVisible(false);
    } catch (error) {
      Alert.alert(error instanceof Error ? error.message : String(error));
    }
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
            style={({ pressed }) => [
              styles.actionPressable,
              webFocusReset,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.agree, { backgroundColor: theme.brand }]}>
              <ThemedText style={styles.agreeText}>{t("consent.agree")}</ThemedText>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={refuse}
            style={({ pressed }) => [
              styles.actionPressable,
              webFocusReset,
              pressed && styles.pressed,
            ]}
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
    alignItems: "center",
    paddingHorizontal: Spacing.four,
  },
  card: {
    borderRadius: 16,
    maxWidth: 420,
    padding: Spacing.five,
    width: "100%",
  },
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
  actionPressable: {
    outlineColor: "transparent",
    outlineWidth: 0,
  },
  agree: {
    marginTop: Spacing.six,
    paddingVertical: Spacing.four,
    borderRadius: 12,
    alignItems: "center",
  },
  agreeText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  refuse: { marginTop: Spacing.two, paddingVertical: Spacing.three, alignItems: "center" },
});
