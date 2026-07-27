import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { isValidAccountPassword, useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

/**
 * Set / change account password while already signed in.
 *
 * Success keeps the current session — no forced re-login. Old password is an
 * optional field: leave blank for first-time set, fill in to change.
 */
export default function AccountSecurityScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string>();

  const passwordsMatch = password === confirm;
  const canSubmit = isValidAccountPassword(password) && passwordsMatch && !busy;

  async function handleSubmit() {
    if (!isValidAccountPassword(password)) {
      setLocalError(t("accountSecurity.invalidPassword"));
      return;
    }
    if (!passwordsMatch) {
      setLocalError(t("accountSecurity.passwordMismatch"));
      return;
    }

    const previous = oldPassword.trim();
    setLocalError(undefined);
    setBusy(true);
    try {
      await auth.saveAccountPassword(password, previous || undefined);
      // Dismiss first, then leave — RN Alert has no callback if buttons are omitted.
      Alert.alert(t("accountSecurity.savedTitle"), t("accountSecurity.savedBody"), [
        { text: t("common.ok"), onPress: () => router.back() },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("accountSecurity.failed");
      setLocalError(message);
      Alert.alert(t("accountSecurity.failed"), message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("accountSecurity.title"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="small" themeColor="textSecondary">
            {t("accountSecurity.subtitle")}
          </ThemedText>

          <ThemedText type="smallBold" style={styles.label}>
            {t("accountSecurity.oldPassword")}
          </ThemedText>
          <TextInput
            autoCapitalize="none"
            onChangeText={(value) => {
              setOldPassword(value);
              setLocalError(undefined);
            }}
            placeholder={t("accountSecurity.oldPasswordPlaceholder")}
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            style={[
              styles.input,
              {
                borderColor: theme.border,
                color: theme.text,
                backgroundColor: theme.backgroundElement,
              },
            ]}
            value={oldPassword}
          />

          <ThemedText type="smallBold" style={styles.label}>
            {t("accountSecurity.newPassword")}
          </ThemedText>
          <TextInput
            autoCapitalize="none"
            onChangeText={(value) => {
              setPassword(value);
              setLocalError(undefined);
            }}
            placeholder={t("accountSecurity.newPasswordPlaceholder")}
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            style={[
              styles.input,
              {
                borderColor: theme.border,
                color: theme.text,
                backgroundColor: theme.backgroundElement,
              },
            ]}
            value={password}
          />

          <ThemedText type="smallBold" style={styles.label}>
            {t("accountSecurity.confirmPassword")}
          </ThemedText>
          <TextInput
            autoCapitalize="none"
            onChangeText={(value) => {
              setConfirm(value);
              setLocalError(undefined);
            }}
            onSubmitEditing={() => {
              if (canSubmit) void handleSubmit();
            }}
            placeholder={t("accountSecurity.confirmPasswordPlaceholder")}
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
            secureTextEntry
            style={[
              styles.input,
              {
                borderColor: theme.border,
                color: theme.text,
                backgroundColor: theme.backgroundElement,
              },
            ]}
            value={confirm}
          />
          {confirm.length > 0 && !passwordsMatch ? (
            <Text style={styles.inlineError}>{t("accountSecurity.passwordMismatch")}</Text>
          ) : null}

          {localError ? <Text style={styles.inlineError}>{localError}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={!canSubmit}
            onPress={() => void handleSubmit()}
            style={({ pressed }) => pressed && canSubmit && styles.pressed}
          >
            <View
              style={[
                styles.button,
                { backgroundColor: canSubmit ? theme.brand : theme.backgroundSelected },
              ]}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
              <ThemedText
                type="smallBold"
                style={[styles.buttonText, !canSubmit && styles.buttonTextDisabled]}
              >
                {t("accountSecurity.submit")}
              </ThemedText>
            </View>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { gap: Spacing.two, padding: Spacing.four },
  label: { marginTop: Spacing.three },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    height: 48,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  inlineError: {
    color: "#FF8088",
    fontSize: 13,
    marginTop: Spacing.one,
  },
  button: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: Spacing.two,
    height: 48,
    justifyContent: "center",
    marginTop: Spacing.five,
  },
  buttonText: { color: "#FFFFFF" },
  buttonTextDisabled: { color: "rgba(255,255,255,0.4)" },
  pressed: { opacity: 0.8 },
});
