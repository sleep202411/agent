import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { completeAuthSheet, sendVerificationCode, useAuth } from "@/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { appEnv } from "@/config";
import { Colors, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

type FieldName = "identifier" | "code" | "password" | "confirmPassword";

const theme = Colors.dark;
const IS_CN = appEnv.siteRegion === "cn";
const RESEND_SECONDS = 60;

const SITE_BASE_URL = IS_CN ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";

function pressedStyle(pressed: boolean) {
  return { opacity: pressed ? 0.7 : 1 };
}

export default function RegisterScreen() {
  const t = useTranslations();
  const auth = useAuth();
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const codeInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const confirmInputRef = useRef<TextInput>(null);

  const [identifier, setIdentifier] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [focusedField, setFocusedField] = useState<FieldName | undefined>();
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();
  const [countdown, setCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);

  const isSubmitting = auth.status === "submitting";
  const canSubmit =
    identifier.trim().length > 0 &&
    code.trim().length > 0 &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    acceptedTerms &&
    !isSubmitting;

  // Dismiss the auth sheet on success, returning the user to their context.
  useEffect(() => {
    if (auth.status === "authenticated") {
      completeAuthSheet(router);
    }
  }, [auth.status, router]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  function clearLocalError() {
    if (localError) setLocalError(undefined);
  }

  function openSitePath(path: string) {
    void Linking.openURL(`${SITE_BASE_URL}${path}`).catch(() => {
      setLocalError(t("login.linkFailed"));
    });
  }

  function identifierMissingError() {
    return IS_CN ? t("register.identifierRequiredPhone") : t("register.identifierRequiredEmail");
  }

  async function handleSendCode() {
    const value = identifier.trim();
    if (!value) {
      setLocalError(identifierMissingError());
      return;
    }
    setSendingCode(true);
    setLocalError(undefined);
    try {
      await sendVerificationCode(value);
      setCountdown(RESEND_SECONDS);
      codeInputRef.current?.focus();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("register.sendCodeFailed"));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit() {
    const value = identifier.trim();
    if (!value) return setLocalError(identifierMissingError());
    if (!code.trim()) return setLocalError(t("register.codeRequired"));
    if (password.length < 6) return setLocalError(t("register.passwordTooShort"));
    if (password !== confirmPassword) return setLocalError(t("register.passwordMismatch"));
    if (!acceptedTerms) return setLocalError(t("login.termsRequired"));

    setLocalError(undefined);
    try {
      await auth.register({ identifier: value, code: code.trim(), password });
      // The authenticated effect dismisses the sheet once state flips.
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("register.failed"));
    }
  }

  const errorMessage = localError ?? auth.error;
  const sendDisabled = sendingCode || countdown > 0;

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
              paddingTop: safeAreaInsets.top + Spacing.two,
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
              accessibilityLabel={t("register.back")}
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButton, pressedStyle(pressed)]}
            >
              <SymbolView
                name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
                size={20}
                tintColor={theme.text}
              />
            </Pressable>

            <View style={styles.header}>
              <Image
                accessibilityLabel="FizzDragon"
                contentFit="contain"
                source={require("@/assets/images/fizzdragon-logo.png")}
                style={styles.logo}
              />
            </View>

            <View style={styles.form}>
              {/* Identifier (phone for CN, email for global) */}
              <View style={styles.field}>
                <Text style={styles.label}>
                  {IS_CN ? t("register.phoneLabel") : t("register.emailLabel")}
                </Text>
                <View
                  style={[
                    styles.inputShell,
                    focusedField === "identifier" && styles.inputShellFocused,
                  ]}
                >
                  <TextInput
                    autoCapitalize="none"
                    autoComplete={IS_CN ? "tel" : "email"}
                    inputMode={IS_CN ? "tel" : "email"}
                    keyboardType={IS_CN ? "phone-pad" : "email-address"}
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={(value) => {
                      setIdentifier(value);
                      clearLocalError();
                    }}
                    onFocus={() => setFocusedField("identifier")}
                    placeholder={
                      IS_CN ? t("register.phonePlaceholder") : t("register.emailPlaceholder")
                    }
                    placeholderTextColor="rgba(255,255,255,0.34)"
                    style={styles.input}
                    value={identifier}
                  />
                </View>
              </View>

              {/* Verification code + send button */}
              <View style={styles.field}>
                <Text style={styles.label}>{t("register.code")}</Text>
                <View
                  style={[styles.inputShell, focusedField === "code" && styles.inputShellFocused]}
                >
                  <TextInput
                    ref={codeInputRef}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    keyboardType="number-pad"
                    maxLength={6}
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={(value) => {
                      setCode(value);
                      clearLocalError();
                    }}
                    onFocus={() => setFocusedField("code")}
                    placeholder={t("register.codePlaceholder")}
                    placeholderTextColor="rgba(255,255,255,0.34)"
                    style={styles.input}
                    textContentType="oneTimeCode"
                    value={code}
                  />
                  <View style={styles.sendDivider} />
                  <Pressable
                    accessibilityRole="button"
                    disabled={sendDisabled}
                    hitSlop={8}
                    onPress={handleSendCode}
                    style={({ pressed }) => [styles.sendButton, pressedStyle(pressed)]}
                  >
                    {sendingCode ? (
                      <ActivityIndicator color={theme.brand} size="small" />
                    ) : (
                      <Text style={[styles.sendText, sendDisabled && styles.sendTextDisabled]}>
                        {countdown > 0 ? `${countdown}s` : t("register.sendCode")}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>

              {/* Password */}
              <View style={styles.field}>
                <Text style={styles.label}>{t("login.password")}</Text>
                <View
                  style={[
                    styles.inputShell,
                    focusedField === "password" && styles.inputShellFocused,
                  ]}
                >
                  <TextInput
                    ref={passwordInputRef}
                    autoCapitalize="none"
                    autoComplete="password-new"
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={(value) => {
                      setPassword(value);
                      clearLocalError();
                    }}
                    onFocus={() => setFocusedField("password")}
                    onSubmitEditing={() => confirmInputRef.current?.focus()}
                    placeholder={t("login.passwordPlaceholder")}
                    placeholderTextColor="rgba(255,255,255,0.34)"
                    returnKeyType="next"
                    secureTextEntry={!showPassword}
                    style={styles.input}
                    textContentType="newPassword"
                    value={password}
                  />
                  <Pressable
                    accessibilityLabel={
                      showPassword ? t("register.hidePassword") : t("register.showPassword")
                    }
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => setShowPassword((value) => !value)}
                    style={({ pressed }) => [styles.eyeButton, pressedStyle(pressed)]}
                  >
                    <SymbolView
                      name={{
                        ios: showPassword ? "eye.slash" : "eye",
                        android: showPassword ? "visibility_off" : "visibility",
                        web: showPassword ? "visibility_off" : "visibility",
                      }}
                      size={18}
                      tintColor="rgba(255,255,255,0.55)"
                    />
                  </Pressable>
                </View>
              </View>

              {/* Confirm password */}
              <View style={styles.field}>
                <Text style={styles.label}>{t("register.confirmPassword")}</Text>
                <View
                  style={[
                    styles.inputShell,
                    focusedField === "confirmPassword" && styles.inputShellFocused,
                  ]}
                >
                  <TextInput
                    ref={confirmInputRef}
                    autoCapitalize="none"
                    autoComplete="password-new"
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      clearLocalError();
                    }}
                    onFocus={() => setFocusedField("confirmPassword")}
                    onSubmitEditing={handleSubmit}
                    placeholder={t("register.confirmPasswordPlaceholder")}
                    placeholderTextColor="rgba(255,255,255,0.34)"
                    returnKeyType="done"
                    secureTextEntry={!showPassword}
                    style={styles.input}
                    textContentType="newPassword"
                    value={confirmPassword}
                  />
                </View>
              </View>

              {errorMessage ? (
                <View accessibilityLiveRegion="polite" style={styles.errorPanel}>
                  <SymbolView
                    name={{ ios: "exclamationmark.circle.fill", android: "error", web: "error" }}
                    size={16}
                    tintColor={theme.brand}
                  />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acceptedTerms }}
                onPress={() => {
                  setAcceptedTerms((value) => !value);
                  clearLocalError();
                }}
                style={({ pressed }) => [styles.termsRow, pressedStyle(pressed)]}
              >
                <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
                  {acceptedTerms ? (
                    <SymbolView
                      name={{ ios: "checkmark", android: "check", web: "check" }}
                      size={12}
                      tintColor="#FFFFFF"
                    />
                  ) : null}
                </View>
                <Text style={styles.termsText}>
                  {t("login.agreementLead")}
                  <Text style={styles.termsLink} onPress={() => openSitePath("/terms-of-service")}>
                    {t("login.terms")}
                  </Text>
                  {t("login.and")}
                  <Text style={styles.termsLink} onPress={() => openSitePath("/privacy-policy")}>
                    {t("login.privacy")}
                  </Text>
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={!canSubmit}
                onPress={handleSubmit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  canSubmit ? styles.primaryButtonEnabled : styles.primaryButtonDisabled,
                  pressed && canSubmit ? styles.pressed : null,
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFFFFF" size="small" style={styles.buttonSpinner} />
                ) : null}
                <Text
                  style={[styles.primaryButtonText, !canSubmit && styles.primaryButtonTextDisabled]}
                >
                  {isSubmitting ? t("register.submitting") : t("register.submit")}
                </Text>
              </Pressable>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>{t("register.haveAccount")}</Text>
              <Pressable
                accessibilityRole="link"
                hitSlop={8}
                onPress={() => router.back()}
                style={({ pressed }) => pressedStyle(pressed)}
              >
                <Text style={styles.footerLink}>{t("login.signIn")}</Text>
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
    maxWidth: MaxContentWidth,
    width: "100%",
  },
  backButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    marginLeft: -Spacing.two,
    width: 40,
  },
  header: {
    alignItems: "center",
    paddingBottom: Spacing.six,
    paddingTop: Spacing.three,
  },
  logo: {
    height: 32,
    width: 180,
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
  sendDivider: {
    backgroundColor: theme.border,
    height: 22,
    marginHorizontal: Spacing.three,
    width: 1,
  },
  sendButton: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 72,
  },
  sendText: {
    color: theme.brand,
    fontSize: 14,
    fontWeight: "600",
  },
  sendTextDisabled: {
    color: "rgba(255,255,255,0.4)",
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
  termsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  checkbox: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: theme.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  checkboxChecked: {
    backgroundColor: theme.brand,
    borderColor: theme.brand,
  },
  termsText: {
    color: theme.textSecondary,
    flex: 1,
    fontSize: 13,
    fontWeight: "400",
    lineHeight: 19,
  },
  termsLink: {
    color: theme.text,
    fontWeight: "600",
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
    fontWeight: "400",
  },
  footerLink: {
    color: theme.brand,
    fontSize: 14,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.85,
  },
});
