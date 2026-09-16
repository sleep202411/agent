import { useAuthFormLifetime, useDelayedAuthFocus } from "@/auth/use-auth-form-lifetime";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import * as Linking from "expo-linking";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
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

import {
  completeAuthSheet,
  hydratePendingCode,
  hydrateResendClock,
  isValidAccountPassword,
  maskIdentifier,
  normalizeIdentifier,
  readPendingCode,
  secondsUntilResend,
  sendResetCode,
  useAuth,
  type NormalizedIdentifier,
} from "@/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { CodeInput } from "@/components/code-input";
import { appEnv } from "@/config";
import { Colors, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

const theme = Colors.dark;
const CODE_LENGTH = 6;

const SITE_BASE_URL =
  appEnv.siteRegion === "cn" ? "https://fizzdragon.fizzspace.cn/zh-CN" : "https://fizzdragon.com";

type Step = "identifier" | "code" | "password";

function interpolate(template: string, vars: Record<string, string | number>) {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

function sameAccount(a: NormalizedIdentifier, b: NormalizedIdentifier) {
  return a.kind === b.kind && a.account === b.account;
}

export default function ForgotPasswordScreen() {
  const t = useTranslations();
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ identifier?: string }>();
  const insets = useSafeAreaInsets();
  const passwordInputRef = useRef<TextInput>(null);

  const [step, setStep] = useState<Step>("identifier");
  const [identifierText, setIdentifierText] = useState(
    typeof params.identifier === "string" ? params.identifier : ""
  );
  const [normalized, setNormalized] = useState<NormalizedIdentifier | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<"password" | "confirm" | undefined>();
  const [resendIn, setResendIn] = useState(0);
  const focused = useIsFocused();
  const operation = useAuthFormOperation(
    JSON.stringify(["forgot-password", params.identifier]),
    focused
  );
  const { capture, markEdited } = useAuthFormLifetime(
    JSON.stringify(["forgot-password", params.identifier]),
    focused
  );
  useDelayedAuthFocus(
    passwordInputRef,
    focused && step === "password",
    JSON.stringify([params.identifier])
  );
  const sendingCode = operation.busy;
  const [localError, setLocalError] = useState<string>();
  const [hydrated, setHydrated] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const isSubmitting = auth.status === "submitting" || sendingCode;
  const errorMessage = localError ?? auth.error;

  const canContinueIdentifier = identifierText.trim().length > 0 && acceptedTerms && !isSubmitting;
  const canSubmitPassword =
    isValidAccountPassword(password) &&
    password === confirmPassword &&
    !isSubmitting &&
    code.length === CODE_LENGTH;

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(secondsUntilResend()), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  // Web `start_reset`: land on the identifier step with the cooldown
  // intact. A live reset code is resumed by Continue (same account), not
  // by auto-jumping to the code step — a sign-in OTP in particular must
  // not open the reset code UI (it cannot complete a reset).
  useEffect(() => {
    if (!focused) return;
    let cancelled = false;
    const current = capture();
    const pristine = capture(true);
    void (async () => {
      await Promise.all([hydrateResendClock(), hydratePendingCode()]);
      if (cancelled || !current()) return;
      setResendIn(secondsUntilResend());
      const pending = readPendingCode();
      if (pending && pristine())
        setIdentifierText((current) => (current.trim() ? current : pending.account.account));
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [focused, capture]);

  function canResumeResetCode(next: NormalizedIdentifier): boolean {
    const pending = readPendingCode();
    return pending?.mode === "reset" && sameAccount(pending.account, next);
  }

  const typedIdentifier = normalizeIdentifier(identifierText);
  const showIdentifierCooldownHint =
    step === "identifier" &&
    resendIn > 0 &&
    !(typedIdentifier !== null && canResumeResetCode(typedIdentifier));

  useEffect(() => {
    if (!focused || operation.busy || auth.status !== "authenticated") return;
    completeAuthSheet(router);
  }, [auth.status, focused, operation.busy, router]);

  function returnToPasswordLogin() {
    router.replace({
      pathname: "/login",
      params: {
        step: "password",
        identifier: identifierText.trim() || normalized?.account || "",
      },
    });
  }

  function openSitePath(path: string) {
    const current = capture();
    void Linking.openURL(`${SITE_BASE_URL}${path}`).catch(() => {
      if (!current()) return;
      setLocalError(t("auth.linkFailed"));
    });
  }

  function acceptCode(next: NormalizedIdentifier) {
    const at = Date.now();
    setNormalized(next);
    setCode("");
    setStep("code");
    setResendIn(secondsUntilResend(at));
  }

  async function handleContinueIdentifier() {
    markEdited();
    const next = normalizeIdentifier(identifierText);
    if (!next) {
      setLocalError(t("auth.errorIdentifierInvalid"));
      return;
    }
    if (!acceptedTerms) {
      setLocalError(t("auth.termsRequired"));
      return;
    }
    setLocalError(undefined);

    const remaining = secondsUntilResend();
    if (remaining > 0) {
      // Same account + reset mode → resume without a second SMS (web
      // `resume_code`). Otherwise the global cooldown blocks the send.
      if (canResumeResetCode(next)) {
        setNormalized(next);
        setCode("");
        setStep("code");
        setResendIn(remaining);
        return;
      }
      setLocalError(t("auth.errorResendCooldown"));
      setResendIn(remaining);
      return;
    }

    await operation.run(
      () => sendResetCode(next),
      () => acceptCode(next),
      (error) => {
        setLocalError(error instanceof Error ? error.message : t("auth.errorServer"));
      }
    );
  }

  function handleConfirmCode(nextCode: string) {
    if (nextCode.trim().length !== CODE_LENGTH) return;
    setCode(nextCode);
    setLocalError(undefined);
    // Reset flow: Java verifies the code together with the new password —
    // advance to the password step (web parity).
    setStep("password");
  }

  function handleCodeChange(value: string) {
    markEdited();
    setCode(value);
    setLocalError(undefined);
    if (value.length === CODE_LENGTH && !isSubmitting) {
      handleConfirmCode(value);
    }
  }

  async function handleResend() {
    if (!normalized || resendIn > 0 || sendingCode) return;
    setLocalError(undefined);
    await operation.run(
      () => sendResetCode(normalized),
      () => acceptCode(normalized),
      (error) => {
        setLocalError(error instanceof Error ? error.message : t("auth.errorServer"));
      }
    );
  }

  async function handleSubmitNewPassword() {
    if (!normalized) return;
    if (code.length !== CODE_LENGTH) {
      setStep("code");
      setLocalError(t("auth.errorCodeRequired"));
      return;
    }
    if (!isValidAccountPassword(password)) {
      setLocalError(t("accountSecurity.invalidPassword"));
      return;
    }
    if (password !== confirmPassword) {
      setLocalError(t("auth.errorPasswordMismatch"));
      return;
    }
    setLocalError(undefined);
    await operation.run(
      () => auth.resetPasswordAndSignIn({ identifier: normalized.account, code, password }),
      () => {},
      (error) => {
        setLocalError(error instanceof Error ? error.message : t("auth.errorServer"));
      }
    );
  }

  const title =
    step === "identifier"
      ? t("auth.resetTitle")
      : step === "code"
        ? t("auth.codeTitle")
        : t("auth.resetPasswordTitle");

  const subtitle =
    step === "identifier"
      ? t("auth.resetSubtitle")
      : step === "code" && normalized
        ? interpolate(t("auth.codeSubtitle"), { account: maskIdentifier(normalized) })
        : normalized
          ? interpolate(t("auth.resetPasswordSubtitle"), {
              account: maskIdentifier(normalized),
            })
          : t("auth.resetPasswordSubtitle");

  if (!hydrated) {
    return <View style={styles.root} />;
  }

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
              paddingTop: insets.top + Spacing.two,
              paddingBottom: insets.bottom + Spacing.five,
              paddingLeft: Math.max(insets.left, Spacing.five),
              paddingRight: Math.max(insets.right, Spacing.five),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.page}>
            <Pressable
              accessibilityLabel={t("auth.back")}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => {
                if (step === "password") {
                  setStep("code");
                  setLocalError(undefined);
                  return;
                }
                if (step === "code") {
                  setStep("identifier");
                  setCode("");
                  setLocalError(undefined);
                  return;
                }
                // Exit reset flow → password login (web cancel_reset parity).
                returnToPasswordLogin();
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

            <View style={styles.heading}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>

            <View style={styles.form}>
              {step === "identifier" ? (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>{t("auth.identifierLabel")}</Text>
                    <View style={styles.inputShell}>
                      <TextInput
                        autoCapitalize="none"
                        autoFocus
                        editable={!isSubmitting}
                        inputMode="email"
                        keyboardType="email-address"
                        onChangeText={(value) => {
                          markEdited();
                          setIdentifierText(value);
                          setLocalError(undefined);
                        }}
                        onSubmitEditing={() => void handleContinueIdentifier()}
                        placeholder={t("auth.identifierPlaceholder")}
                        placeholderTextColor="rgba(255,255,255,0.34)"
                        returnKeyType="done"
                        style={styles.input}
                        value={identifierText}
                      />
                    </View>
                    {showIdentifierCooldownHint ? (
                      <Text style={styles.hint}>
                        {interpolate(t("auth.codeResendCountdown"), { seconds: resendIn })}
                      </Text>
                    ) : null}
                  </View>

                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: acceptedTerms }}
                    onPress={() => {
                      markEdited();
                      setAcceptedTerms((current) => !current);
                      setLocalError(undefined);
                    }}
                    style={({ pressed }) => (pressed ? styles.pressed : null)}
                  >
                    <View style={styles.termsRow}>
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
                        <Text
                          style={styles.termsLink}
                          onPress={() => openSitePath("/terms-of-service")}
                        >
                          {t("login.terms")}
                        </Text>
                        {t("login.and")}
                        <Text
                          style={styles.termsLink}
                          onPress={() => openSitePath("/privacy-policy")}
                        >
                          {t("login.privacy")}
                        </Text>
                      </Text>
                    </View>
                  </Pressable>
                </>
              ) : null}

              {step === "code" ? (
                <View style={styles.field}>
                  <CodeInput
                    autoFocus
                    disabled={isSubmitting}
                    invalid={!!errorMessage}
                    label={t("auth.codeInputLabel")}
                    length={CODE_LENGTH}
                    onChange={handleCodeChange}
                    value={code}
                  />
                  <Text style={styles.hint}>{t("auth.codeSent")}</Text>
                </View>
              ) : null}

              {step === "password" ? (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>{t("auth.newPasswordLabel")}</Text>
                    <View
                      style={[
                        styles.inputShell,
                        focusedField === "password" && styles.inputShellFocused,
                      ]}
                    >
                      <TextInput
                        ref={passwordInputRef}
                        autoCapitalize="none"
                        editable={!isSubmitting}
                        onBlur={() => setFocusedField(undefined)}
                        onChangeText={(value) => {
                          markEdited();
                          setPassword(value);
                          setLocalError(undefined);
                        }}
                        onFocus={() => setFocusedField("password")}
                        placeholder={t("accountSecurity.newPasswordPlaceholder")}
                        placeholderTextColor="rgba(255,255,255,0.34)"
                        secureTextEntry={!showPassword}
                        style={styles.input}
                        value={password}
                      />
                      <Pressable
                        accessibilityRole="button"
                        hitSlop={10}
                        onPress={() => setShowPassword((v) => !v)}
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
                    <Text style={styles.label}>{t("auth.confirmPasswordLabel")}</Text>
                    <View
                      style={[
                        styles.inputShell,
                        focusedField === "confirm" && styles.inputShellFocused,
                      ]}
                    >
                      <TextInput
                        autoCapitalize="none"
                        editable={!isSubmitting}
                        onBlur={() => setFocusedField(undefined)}
                        onChangeText={(value) => {
                          markEdited();
                          setConfirmPassword(value);
                          setLocalError(undefined);
                        }}
                        onFocus={() => setFocusedField("confirm")}
                        onSubmitEditing={() => void handleSubmitNewPassword()}
                        placeholder={t("auth.confirmPasswordPlaceholder")}
                        placeholderTextColor="rgba(255,255,255,0.34)"
                        returnKeyType="done"
                        secureTextEntry={!showPassword}
                        style={styles.input}
                        value={confirmPassword}
                      />
                    </View>
                  </View>
                </>
              ) : null}

              {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

              {step === "identifier" ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={!canContinueIdentifier}
                  onPress={() => void handleContinueIdentifier()}
                  style={({ pressed }) =>
                    pressed && canContinueIdentifier ? styles.pressed : null
                  }
                >
                  <View
                    style={[
                      styles.primaryButton,
                      canContinueIdentifier ? styles.primaryEnabled : styles.primaryDisabled,
                    ]}
                  >
                    {sendingCode ? (
                      <ActivityIndicator color="#FFFFFF" style={styles.spinner} />
                    ) : null}
                    <Text
                      style={[
                        styles.primaryText,
                        !canContinueIdentifier && styles.primaryTextDisabled,
                      ]}
                    >
                      {t("auth.continue")}
                    </Text>
                  </View>
                </Pressable>
              ) : null}

              {step === "code" ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    disabled={code.length !== CODE_LENGTH || isSubmitting}
                    onPress={() => handleConfirmCode(code)}
                    style={({ pressed }) =>
                      pressed && code.length === CODE_LENGTH ? styles.pressed : null
                    }
                  >
                    <View
                      style={[
                        styles.primaryButton,
                        code.length === CODE_LENGTH && !isSubmitting
                          ? styles.primaryEnabled
                          : styles.primaryDisabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.primaryText,
                          (code.length !== CODE_LENGTH || isSubmitting) &&
                            styles.primaryTextDisabled,
                        ]}
                      >
                        {t("auth.verify")}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={styles.codeActions}>
                    <Pressable
                      onPress={() => {
                        markEdited();
                        setStep("identifier");
                        setCode("");
                        setLocalError(undefined);
                      }}
                    >
                      <Text style={styles.quietLink}>{t("auth.codeEditIdentifier")}</Text>
                    </Pressable>
                    <Pressable
                      disabled={resendIn > 0 || sendingCode}
                      onPress={() => void handleResend()}
                    >
                      <Text
                        style={[
                          styles.quietLink,
                          (resendIn > 0 || sendingCode) && styles.quietLinkDisabled,
                        ]}
                      >
                        {resendIn > 0
                          ? interpolate(t("auth.codeResendCountdown"), { seconds: resendIn })
                          : t("auth.codeResend")}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : null}

              {step === "password" ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={!canSubmitPassword}
                  onPress={() => void handleSubmitNewPassword()}
                  style={({ pressed }) => (pressed && canSubmitPassword ? styles.pressed : null)}
                >
                  <View
                    style={[
                      styles.primaryButton,
                      canSubmitPassword ? styles.primaryEnabled : styles.primaryDisabled,
                    ]}
                  >
                    {auth.status === "submitting" ? (
                      <ActivityIndicator color="#FFFFFF" style={styles.spinner} />
                    ) : null}
                    <Text
                      style={[styles.primaryText, !canSubmitPassword && styles.primaryTextDisabled]}
                    >
                      {t("auth.resetSubmit")}
                    </Text>
                  </View>
                </Pressable>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <LanguageSwitcher style={[styles.langSwitch, { top: insets.top + Spacing.two }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: theme.background, flex: 1 },
  flex: { flex: 1 },
  langSwitch: { position: "absolute", right: Spacing.five, zIndex: 10 },
  scrollContent: { alignItems: "center", flexGrow: 1 },
  page: { flex: 1, gap: Spacing.five, maxWidth: MaxContentWidth, width: "100%" },
  backButton: { alignItems: "center", height: 40, justifyContent: "center", width: 40 },
  heading: { gap: Spacing.two },
  title: { color: theme.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.3 },
  subtitle: { color: theme.textSecondary, fontSize: 14, lineHeight: 20 },
  form: { gap: Spacing.four },
  field: { gap: Spacing.two },
  label: { color: theme.textSecondary, fontSize: 13, fontWeight: "600" },
  hint: { color: theme.textSecondary, fontSize: 13, marginTop: Spacing.one },
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
  eyeButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    marginLeft: Spacing.two,
    width: 32,
  },
  error: { color: "#FF8088", fontSize: 13 },
  termsRow: {
    alignItems: "flex-start",
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
    flexShrink: 0,
    height: 22,
    justifyContent: "center",
    marginTop: 1,
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
  primaryEnabled: { backgroundColor: theme.brand },
  primaryDisabled: { backgroundColor: theme.backgroundSelected },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  primaryTextDisabled: { color: "rgba(255,255,255,0.4)" },
  spinner: { marginRight: Spacing.two },
  codeActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.one,
  },
  quietLink: { color: theme.brand, fontSize: 14, fontWeight: "600" },
  quietLinkDisabled: { color: theme.textSecondary },
  pressed: { opacity: 0.72 },
});
