import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

/** Personal-center entry to bind an invite code after skipping onboarding. */
export default function BindInviteScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = code.trim().length > 0 && !busy;

  async function handleSubmit() {
    const value = code.trim();
    if (!value) return;
    setBusy(true);
    try {
      await auth.submitInviteCode(value);
      // Dismiss first, then leave — RN Alert has no callback if buttons are omitted.
      Alert.alert(t("settings.bindInviteSuccess"), undefined, [
        { text: t("common.ok"), onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert(error instanceof Error ? error.message : t("auth.errorInviteCodeInvalid"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("settings.bindInvite"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      <View style={styles.content}>
        <TextInput
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
          onChangeText={setCode}
          onSubmitEditing={() => {
            if (canSubmit) void handleSubmit();
          }}
          placeholder={t("auth.invitePlaceholder")}
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          style={[
            styles.input,
            {
              borderColor: theme.border,
              color: theme.text,
              backgroundColor: theme.backgroundElement,
            },
          ]}
          value={code}
        />
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
              {t("auth.inviteSubmit")}
            </ThemedText>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: Spacing.three, padding: Spacing.four },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    height: 48,
    paddingHorizontal: Spacing.three,
  },
  button: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: Spacing.two,
    height: 48,
    justifyContent: "center",
  },
  buttonText: { color: "#FFFFFF" },
  buttonTextDisabled: { color: "rgba(255,255,255,0.4)" },
  pressed: { opacity: 0.8 },
});
