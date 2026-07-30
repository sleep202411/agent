import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
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

import { clearIsNewUserFlag, completeAuthSheet, useAuth } from "@/auth";
import { Colors, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

const theme = Colors.dark;

export default function InviteCodeScreen() {
  const t = useTranslations();
  const auth = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const canSubmit = code.trim().length > 0 && !busy;

  async function finish() {
    await clearIsNewUserFlag();
    completeAuthSheet(router);
  }

  async function handleSubmit() {
    const value = code.trim();
    if (!value) return;
    setBusy(true);
    setError(undefined);
    try {
      await auth.submitInviteCode(value);
      await finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.errorInviteCodeInvalid"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.three }]}>
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
          <Pressable
            accessibilityLabel={t("auth.back")}
            accessibilityRole="button"
            disabled={busy}
            hitSlop={8}
            onPress={() => {
              router.replace("/profile-setup");
            }}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <View style={styles.backButton}>
              <SymbolView
                name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
                size={20}
                tintColor={theme.text}
              />
            </View>
          </Pressable>

          <Text style={styles.title}>{t("auth.inviteTitle")}</Text>
          <Text style={styles.subtitle}>{t("auth.inviteSubtitle")}</Text>

          <View style={styles.field}>
            <Text style={styles.label}>{t("auth.inviteLabel")}</Text>
            <View style={styles.inputShell}>
              <TextInput
                autoCapitalize="characters"
                autoFocus
                editable={!busy}
                onChangeText={(value) => {
                  setCode(value);
                  setError(undefined);
                }}
                placeholder={t("auth.invitePlaceholder")}
                placeholderTextColor="rgba(255,255,255,0.34)"
                style={styles.input}
                value={code}
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
                {t("auth.inviteSubmit")}
              </Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void finish()}
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
  backButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    marginLeft: -8,
    width: 40,
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
