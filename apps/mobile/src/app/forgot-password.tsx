import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { resetPasswordWithIdentifier, sendVerificationCode } from "@/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { appEnv } from "@/config";
import { Colors, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

const theme = Colors.dark;
const IS_CN = appEnv.siteRegion === "cn";
const RESEND_SECONDS = 60;
const MIN_PASSWORD = 6;

type FieldName = "identifier" | "code" | "password" | "confirmPassword";

export default function ForgotPasswordScreen() {
  const t = useTranslations();
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();

  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [focusedField, setFocusedField] = useState<FieldName | undefined>();
  const [showPassword, setShowPassword] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const trimmedId = identifier.trim();
  const canSendCode = trimmedId.length > 0 && countdown === 0 && !sendingCode;
  const canSubmit =
    trimmedId.length > 0 &&
    code.trim().length > 0 &&
    password.length >= MIN_PASSWORD &&
    password === confirmPassword &&
    !submitting;

  async function handleSendCode() {
    if (!trimmedId) {
      setError(
        IS_CN
          ? t("forgotPassword.identifierRequiredPhone")
          : t("forgotPassword.identifierRequiredEmail")
      );
      return;
    }
    setError(undefined);
    setSendingCode(true);
    try {
      await sendVerificationCode(trimmedId);
      setCountdown(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("forgotPassword.sendCodeFailed"));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit() {
    if (!code.trim()) {
      setError(t("forgotPassword.codeRequired"));
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(t("forgotPassword.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("forgotPassword.passwordMismatch"));
      return;
    }
    setError(undefined);
    setSubmitting(true);
    try {
      await resetPasswordWithIdentifier({ identifier: trimmedId, code, password });
      Alert.alert(t("forgotPassword.successTitle"), t("forgotPassword.successMessage"), [
        { text: t("forgotPassword.backToLogin"), onPress: () => router.replace("/login") },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("forgotPassword.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const codeButtonLabel =
    countdown > 0
      ? `${countdown}s`
      : sendingCode
        ? t("forgotPassword.sending")
        : t("forgotPassword.sendCode");

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: safeAreaInsets.top + Spacing.three,
              paddingBottom: safeAreaInsets.bottom + Spacing.five,
              paddingLeft: Math.max(safeAreaInsets.left, Spacing.five),
              paddingRight: Math.max(safeAreaInsets.right, Spacing.five),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.page}>
            <Pressable
              accessibilityLabel={t("forgotPassword.back")}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => router.back()}
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

            <View style={styles.heading}>
              <Text style={styles.title}>{t("forgotPassword.title")}</Text>
              <Text style={styles.subtitle}>{t("forgotPassword.subtitle")}</Text>
            </View>

            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>
                  {IS_CN ? t("forgotPassword.phoneLabel") : t("forgotPassword.emailLabel")}
                </Text>
                <View
                  style={[
                    styles.inputShell,
                    focusedField === "identifier" && styles.inputShellFocused,
                  ]}
                >
                  <TextInput
                    autoCapitalize="none"
                    inputMode={IS_CN ? "tel" : "email"}
                    keyboardType={IS_CN ? "phone-pad" : "email-address"}
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={(value) => {
                      setIdentifier(value);
                      if (error) setError(undefined);
                    }}
                    onFocus={() => setFocusedField("identifier")}
                    placeholder={
                      IS_CN
                        ? t("forgotPassword.phonePlaceholder")
                        : t("forgotPassword.emailPlaceholder")
                    }
                    placeholderTextColor="rgba(255,255,255,0.34)"
                    style={styles.input}
                    value={identifier}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("forgotPassword.code")}</Text>
                <View style={styles.codeRow}>
                  <View
                    style={[
                      styles.inputShell,
                      styles.codeInputShell,
                      focusedField === "code" && styles.inputShellFocused,
                    ]}
                  >
                    <TextInput
                      autoCapitalize="none"
                      inputMode="numeric"
                      keyboardType="number-pad"
                      onBlur={() => setFocusedField(undefined)}
                      onChangeText={(value) => {
                        setCode(value);
                        if (error) setError(undefined);
                      }}
                      onFocus={() => setFocusedField("code")}
                      placeholder={t("forgotPassword.codePlaceholder")}
                      placeholderTextColor="rgba(255,255,255,0.34)"
                      style={styles.input}
                      value={code}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!canSendCode}
                    onPress={handleSendCode}
                    style={({ pressed }) => (pressed && canSendCode ? styles.pressed : null)}
                  >
                    <View style={[styles.codeButton, !canSendCode && styles.codeButtonDisabled]}>
                      <Text
                        style={[
                          styles.codeButtonText,
                          !canSendCode && styles.codeButtonTextDisabled,
                        ]}
                      >
                        {codeButtonLabel}
                      </Text>
                    </View>
                  </Pressable>
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("forgotPassword.newPassword")}</Text>
                <View
                  style={[
                    styles.inputShell,
                    focusedField === "password" && styles.inputShellFocused,
                  ]}
                >
                  <TextInput
                    autoCapitalize="none"
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={(value) => {
                      setPassword(value);
                      if (error) setError(undefined);
                    }}
                    onFocus={() => setFocusedField("password")}
                    placeholder={t("forgotPassword.newPasswordPlaceholder")}
                    placeholderTextColor="rgba(255,255,255,0.34)"
                    secureTextEntry={!showPassword}
                    style={styles.input}
                    value={password}
                  />
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => setShowPassword((current) => !current)}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}
                  >
                    <View style={styles.eyeButton}>
                      <SymbolView
                        name={{
                          ios: showPassword ? "eye.slash" : "eye",
                          android: showPassword ? "visibility_off" : "visibility",
                          web: showPassword ? "visibility_off" : "visibility",
                        }}
                        size={18}
                        tintColor="rgba(255,255,255,0.55)"
                      />
                    </View>
                  </Pressable>
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>{t("forgotPassword.confirmPassword")}</Text>
                <View
                  style={[
                    styles.inputShell,
                    focusedField === "confirmPassword" && styles.inputShellFocused,
                  ]}
                >
                  <TextInput
                    autoCapitalize="none"
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      if (error) setError(undefined);
                    }}
                    onFocus={() => setFocusedField("confirmPassword")}
                    onSubmitEditing={handleSubmit}
                    placeholder={t("forgotPassword.confirmPasswordPlaceholder")}
                    placeholderTextColor="rgba(255,255,255,0.34)"
                    returnKeyType="done"
                    secureTextEntry={!showPassword}
                    style={styles.input}
                    value={confirmPassword}
                  />
                </View>
              </View>

              {error ? (
                <View accessibilityLiveRegion="polite" style={styles.errorPanel}>
                  <SymbolView
                    name={{ ios: "exclamationmark.circle.fill", android: "error", web: "error" }}
                    size={16}
                    tintColor={theme.brand}
                  />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={!canSubmit}
                onPress={handleSubmit}
                style={({ pressed }) => (pressed && canSubmit ? styles.pressed : null)}
              >
                <View
                  style={[
                    styles.primaryButton,
                    canSubmit ? styles.primaryButtonEnabled : styles.primaryButtonDisabled,
                  ]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" style={styles.buttonSpinner} />
                  ) : null}
                  <Text
                    style={[
                      styles.primaryButtonText,
                      !canSubmit && styles.primaryButtonTextDisabled,
                    ]}
                  >
                    {submitting ? t("forgotPassword.submitting") : t("forgotPassword.submit")}
                  </Text>
                </View>
              </Pressable>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>{t("forgotPassword.remembered")}</Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => router.replace("/login")}
                style={({ pressed }) => (pressed ? styles.pressed : null)}
              >
                <Text style={styles.footerLink}>{t("forgotPassword.backToLogin")}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <LanguageSwitcher style={[styles.langSwitch, { top: safeAreaInsets.top + Spacing.two }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: theme.background,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  langSwitch: {
    position: "absolute",
    right: Spacing.five,
    zIndex: 10,
  },
  scrollContent: {
    alignItems: "center",
    flexGrow: 1,
  },
  page: {
    flex: 1,
    gap: Spacing.five,
    maxWidth: MaxContentWidth,
    width: "100%",
  },
  backButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  heading: {
    gap: Spacing.two,
  },
  title: {
    color: theme.text,
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  subtitle: {
    color: theme.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  form: {
    gap: Spacing.four,
  },
  field: {
    gap: Spacing.two,
  },
  label: {
    color: theme.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  inputShell: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    height: 54,
    paddingHorizontal: Spacing.four,
  },
  inputShellFocused: {
    backgroundColor: "rgba(229,34,39,0.06)",
    borderColor: theme.brand,
  },
  input: {
    color: theme.text,
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    height: "100%",
    padding: 0,
  },
  codeRow: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  codeInputShell: {
    flex: 1,
  },
  codeButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 54,
    justifyContent: "center",
    minWidth: 104,
    paddingHorizontal: Spacing.three,
  },
  codeButtonDisabled: {
    opacity: 0.5,
  },
  codeButtonText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: "600",
  },
  codeButtonTextDisabled: {
    color: theme.textSecondary,
  },
  eyeButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    marginLeft: Spacing.two,
    width: 32,
  },
  errorPanel: {
    alignItems: "center",
    backgroundColor: "rgba(229,34,39,0.1)",
    borderColor: "rgba(229,34,39,0.32)",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  errorText: {
    color: "#FF8088",
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 14,
    flexDirection: "row",
    height: 54,
    justifyContent: "center",
    marginTop: Spacing.two,
  },
  primaryButtonEnabled: {
    backgroundColor: theme.brand,
  },
  primaryButtonDisabled: {
    backgroundColor: theme.backgroundSelected,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  primaryButtonTextDisabled: {
    color: "rgba(255,255,255,0.4)",
  },
  buttonSpinner: {
    marginRight: Spacing.two,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "center",
    marginTop: "auto",
    paddingTop: Spacing.five,
  },
  footerText: {
    color: theme.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color: theme.brand,
    fontSize: 14,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.72,
  },
});
