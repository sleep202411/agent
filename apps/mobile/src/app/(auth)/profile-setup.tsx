import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth";
import { Colors, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

const theme = Colors.dark;

export default function ProfileSetupScreen() {
  const t = useTranslations();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const canSubmit = nickname.trim().length > 0 && !busy;

  async function goInvite() {
    router.replace("/invite-code");
  }

  async function handleSubmit() {
    const value = nickname.trim();
    if (!value) return;
    setBusy(true);
    setError(undefined);
    try {
      await auth.saveOnboardingNickname(value);
      await goInvite();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errorServer"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.six }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View
          style={[
            styles.page,
            {
              paddingBottom: insets.bottom + Spacing.five,
              paddingHorizontal: Math.max(insets.left, Spacing.five),
            },
          ]}
        >
          <Text style={styles.title}>{t("auth.profileTitle")}</Text>
          <Text style={styles.subtitle}>{t("auth.profileSubtitle")}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t("auth.nicknameLabel")}</Text>
            <View style={styles.inputShell}>
              <TextInput
                autoFocus
                editable={!busy}
                onChangeText={(value) => {
                  setNickname(value);
                  setError(undefined);
                }}
                placeholder={t("auth.nicknamePlaceholder")}
                placeholderTextColor="rgba(255,255,255,0.34)"
                style={styles.input}
                value={nickname}
              />
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={() => void handleSubmit()}
            style={({ pressed }) => (pressed && canSubmit ? styles.pressed : null)}
          >
            <View
              style={[
                styles.primaryButton,
                canSubmit ? styles.primaryEnabled : styles.primaryDisabled,
              ]}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" style={styles.spinner} /> : null}
              <Text style={[styles.primaryText, !canSubmit && styles.primaryTextDisabled]}>
                {t("auth.profileSubmit")}
              </Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void goInvite()}
            style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
          >
            <Text style={styles.skipText}>{t("auth.skip")}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: theme.background, flex: 1 },
  flex: { flex: 1 },
  page: {
    alignSelf: "center",
    flex: 1,
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    width: "100%",
  },
  title: { color: theme.text, fontSize: 24, fontWeight: "700" },
  subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  field: { gap: Spacing.two, marginTop: Spacing.three },
  label: { color: theme.textSecondary, fontSize: 13, fontWeight: "600" },
  inputShell: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 54,
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
  },
  input: { color: theme.text, fontSize: 16, fontWeight: "500", padding: 0 },
  error: { color: "#FF8088", fontSize: 13 },
  primaryButton: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    height: 54,
    justifyContent: "center",
    marginTop: Spacing.three,
  },
  primaryEnabled: { backgroundColor: theme.brand },
  primaryDisabled: { backgroundColor: theme.backgroundSelected },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  primaryTextDisabled: { color: "rgba(255,255,255,0.4)" },
  spinner: { marginRight: Spacing.two },
  skip: { alignItems: "center", paddingVertical: Spacing.three },
  skipText: { color: theme.textSecondary, fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.75 },
});
