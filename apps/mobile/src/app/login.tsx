import { useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export default function LoginScreen() {
  const auth = useAuth();
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | undefined>();
  const isSubmitting = auth.status === "submitting";
  const canSubmit = identifier.trim().length > 0 && password.length > 0 && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit) {
      setLocalError("Enter your email or phone and password.");
      return;
    }

    setLocalError(undefined);

    try {
      await auth.signIn({ identifier, password });
      router.replace("/");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Sign in failed.");
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.keyboardView, { backgroundColor: theme.background }]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: safeAreaInsets.top + Spacing.five,
            paddingBottom: safeAreaInsets.bottom + Spacing.five,
            paddingLeft: Math.max(safeAreaInsets.left, Spacing.four),
            paddingRight: Math.max(safeAreaInsets.right, Spacing.four),
          },
        ]}
      >
        <View style={styles.page}>
          <View style={styles.header}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              FizzDragon account
            </ThemedText>
            <ThemedText type="title" style={styles.title}>
              Sign in
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              Use the same account as the web studio to sync projects, credits, and creator profile.
            </ThemedText>
          </View>

          <ThemedView type="backgroundElement" style={styles.formPanel}>
            <View style={styles.fieldGroup}>
              <ThemedText type="smallBold">Email or phone</ThemedText>
              <TextInput
                accessibilityLabel="Email or phone"
                autoCapitalize="none"
                autoComplete="username"
                inputMode="email"
                keyboardType="email-address"
                onChangeText={setIdentifier}
                placeholder="name@example.com"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="next"
                style={[
                  styles.input,
                  {
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                textContentType="username"
                value={identifier}
              />
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText type="smallBold">Password</ThemedText>
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoComplete="password"
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
                secureTextEntry
                style={[
                  styles.input,
                  {
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
                textContentType="password"
                value={password}
                onSubmitEditing={handleSubmit}
              />
            </View>

            {(localError ?? auth.error) && (
              <ThemedView type="backgroundSelected" style={styles.errorPanel}>
                <ThemedText type="smallBold" style={{ color: theme.brand }}>
                  {localError ?? auth.error}
                </ThemedText>
              </ThemedView>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={({ pressed }) => [
                styles.submitButton,
                { backgroundColor: theme.brand },
                !canSubmit && styles.submitButtonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <ThemedText type="smallBold" style={styles.submitText}>
                {isSubmitting ? "Signing in" : "Sign in"}
              </ThemedText>
            </Pressable>
          </ThemedView>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/")}
            style={styles.backButton}
          >
            <ThemedText type="smallBold" themeColor="textSecondary">
              Back
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  content: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
  },
  page: {
    width: "100%",
    maxWidth: MaxContentWidth,
    gap: Spacing.four,
  },
  header: {
    gap: Spacing.two,
  },
  title: {
    fontSize: 38,
    lineHeight: 44,
  },
  subtitle: {
    maxWidth: 520,
  },
  formPanel: {
    borderRadius: 8,
    gap: Spacing.four,
    padding: Spacing.four,
  },
  fieldGroup: {
    gap: Spacing.two,
  },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
  },
  errorPanel: {
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  submitButton: {
    alignItems: "center",
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  submitButtonDisabled: {
    opacity: 0.48,
  },
  submitText: {
    color: "#FFFFFF",
  },
  backButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.72,
  },
});
