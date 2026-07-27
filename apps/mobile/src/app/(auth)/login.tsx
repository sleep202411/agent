import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  armResendDeadline,
  completeAuthSheet,
  hydratePendingCode,
  hydrateResendClock,
  maskIdentifier,
  normalizeIdentifier,
  readPendingCode,
  RESEND_COOLDOWN_SECONDS,
  secondsUntilResend,
  sendLoginCode,
  skipAuthSheet,
  useAuth,
  writePendingCode,
  type NormalizedIdentifier,
} from "@/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { CodeInput } from "@/components/code-input";
import { appEnv } from "@/config";
import { Colors, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

type Step = "identifier" | "code" | "password";
type FieldName = "identifier" | "password" | "code";

const theme = Colors.dark;
const CODE_LENGTH = 6;

const SITE_BASE_URL =
  appEnv.siteRegion === "cn" ? "https://fizzdragon.fizzspace.cn/zh-CN" : "https://fizzdragon.com";

function pressedStyle(pressed: boolean) {
  return { opacity: pressed ? 0.7 : 1 };
}

function interpolate(template: string, vars: Record<string, string | number>) {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

export default function LoginScreen() {
  const t = useTranslations();
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ step?: string; identifier?: string }>();
  const safeAreaInsets = useSafeAreaInsets();
  const passwordInputRef = useRef<TextInput>(null);

  const initialPasswordStep = params.step === "password";
  const [step, setStep] = useState<Step>(initialPasswordStep ? "password" : "identifier");
  const [identifierText, setIdentifierText] = useState(
    typeof params.identifier === "string" ? params.identifier : ""
  );
  const [normalized, setNormalized] = useState<NormalizedIdentifier | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [focusedField, setFocusedField] = useState<FieldName | undefined>();
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();
  const [sendingCode, setSendingCode] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  /** When true, authenticated effect must NOT dismiss — onboarding owns the next screen. */
  const [awaitingOnboarding, setAwaitingOnboarding] = useState(false);

  const isSubmitting = auth.status === "submitting" || sendingCode;
  const errorMessage = localError ?? auth.error;
  const hasIdentifier = identifierText.trim().length > 0;
  const canContinueIdentifier = hasIdentifier && acceptedTerms && !isSubmitting;
  const canPasswordSignIn =
    identifierText.trim().length > 0 && password.length > 0 && acceptedTerms && !isSubmitting;
  const canSubmitPrimary =
    step === "identifier"
      ? canContinueIdentifier
      : step === "password"
        ? canPasswordSignIn
        : step === "code"
          ? code.length === CODE_LENGTH && !isSubmitting
          : false;

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(secondsUntilResend()), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([hydrateResendClock(), hydratePendingCode()]);
      if (cancelled) return;
      const remaining = secondsUntilResend();
      setResendIn(remaining);

      // Returning from forgot-password: stay on the password step (web
      // cancel_reset parity). Don't override with a pending sign-in code.
      if (params.step === "password") {
        setStep("password");
        if (typeof params.identifier === "string" && params.identifier) {
          setIdentifierText(params.identifier);
        }
        setTimeout(() => passwordInputRef.current?.focus(), 50);
        return;
      }

      const pending = readPendingCode();
      if (pending?.mode === "signin") {
        setNormalized(pending.account);
        setIdentifierText(pending.account.account);
        setStep("code");
        setCode("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.identifier, params.step]);

  useEffect(() => {
    if (auth.status !== "authenticated" || awaitingOnboarding) return;
    completeAuthSheet(router);
  }, [auth.status, awaitingOnboarding, router]);

  function openSitePath(path: string) {
    void Linking.openURL(`${SITE_BASE_URL}${path}`).catch(() => {
      setLocalError(t("auth.linkFailed"));
    });
  }

  function clearLocalError() {
    if (localError) setLocalError(undefined);
  }

  function sameAccount(a: NormalizedIdentifier, b: NormalizedIdentifier) {
    return a.kind === b.kind && a.account === b.account;
  }

  async function finishSession(session: { isNewUser?: boolean }) {
    if (session.isNewUser) {
      setAwaitingOnboarding(true);
      router.replace("/profile-setup");
      return;
    }
    // Effect will call completeAuthSheet once status is authenticated.
  }

  async function sendCodeFor(next: NormalizedIdentifier) {
    await sendLoginCode(next);
    const at = Date.now();
    armResendDeadline(at + RESEND_COOLDOWN_SECONDS * 1000);
    writePendingCode({ account: next, mode: "signin" });
    setNormalized(next);
    setCode("");
    setStep("code");
    setResendIn(secondsUntilResend(at));
  }

  async function handleContinueIdentifier() {
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
      const pending = readPendingCode();
      if (pending?.mode === "signin" && sameAccount(pending.account, next)) {
        // Same account already billed — resume code step, no second SMS.
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

    setSendingCode(true);
    try {
      await sendCodeFor(next);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("auth.errorServer"));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleVerifyCode(nextCode: string) {
    if (!normalized) return;
    if (nextCode.trim().length !== CODE_LENGTH) {
      setLocalError(t("auth.errorCodeRequired"));
      return;
    }
    setLocalError(undefined);
    try {
      const session = await auth.continueWithCode(normalized, nextCode.trim());
      await finishSession(session);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("auth.errorCodeIncorrect"));
      setCode("");
    }
  }

  function handleCodeChange(value: string) {
    setCode(value);
    clearLocalError();
    // Match web auth-flow: auto-submit once the sixth digit lands
    // (typing or paste) — no need to hunt for the Verify button.
    if (value.length === CODE_LENGTH && !isSubmitting) {
      void handleVerifyCode(value);
    }
  }

  async function handleResend() {
    if (!normalized || resendIn > 0 || sendingCode) return;
    setSendingCode(true);
    setLocalError(undefined);
    try {
      await sendCodeFor(normalized);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("auth.errorServer"));
    } finally {
      setSendingCode(false);
    }
  }

  async function handlePasswordSignIn() {
    const next = normalizeIdentifier(identifierText);
    if (!next) {
      setLocalError(t("auth.errorIdentifierInvalid"));
      return;
    }
    if (!password) {
      setLocalError(t("auth.errorPasswordRequired"));
      return;
    }
    if (!acceptedTerms) {
      setLocalError(t("auth.termsRequired"));
      return;
    }
    setLocalError(undefined);
    setNormalized(next);
    try {
      const session = await auth.signIn({
        identifier: next.account,
        password,
      });
      await finishSession(session);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("auth.errorCredentialsIncorrect"));
    }
  }

  const termsCheckbox = (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: acceptedTerms }}
      onPress={() => {
        setAcceptedTerms((current) => !current);
        clearLocalError();
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
          <Text style={styles.termsLink} onPress={() => openSitePath("/terms-of-service")}>
            {t("login.terms")}
          </Text>
          {t("login.and")}
          <Text style={styles.termsLink} onPress={() => openSitePath("/privacy-policy")}>
            {t("login.privacy")}
          </Text>
        </Text>
      </View>
    </Pressable>
  );

  const title =
    step === "identifier"
      ? t("auth.identifierTitle")
      : step === "code"
        ? t("auth.codeTitle")
        : t("auth.passwordTitle");

  const subtitle =
    step === "identifier"
      ? t("auth.identifierSubtitle")
      : step === "code" && normalized
        ? interpolate(t("auth.codeSubtitle"), { account: maskIdentifier(normalized) })
        : t("auth.passwordSubtitle");

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
            <View style={styles.header}>
              <Image
                accessibilityLabel="FizzDragon"
                contentFit="contain"
                source={require("@/assets/images/fizzdragon-logo.png")}
                style={styles.logo}
              />
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>

            <View style={styles.form}>
              {step === "identifier" ? (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>{t("auth.identifierLabel")}</Text>
                    <View
                      style={[
                        styles.inputShell,
                        focusedField === "identifier" && styles.inputShellFocused,
                      ]}
                    >
                      <TextInput
                        accessibilityLabel={t("auth.identifierLabel")}
                        autoCapitalize="none"
                        autoComplete="username"
                        inputMode="email"
                        keyboardType="email-address"
                        onBlur={() => setFocusedField(undefined)}
                        onChangeText={(value) => {
                          setIdentifierText(value);
                          clearLocalError();
                        }}
                        onFocus={() => setFocusedField("identifier")}
                        onSubmitEditing={() => void handleContinueIdentifier()}
                        placeholder={t("auth.identifierPlaceholder")}
                        placeholderTextColor="rgba(255,255,255,0.34)"
                        returnKeyType="done"
                        style={styles.input}
                        textContentType="username"
                        value={identifierText}
                      />
                    </View>
                  </View>

                  {termsCheckbox}
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
                  <Text style={styles.codeHint}>{t("auth.codeSent")}</Text>
                </View>
              ) : null}

              {step === "password" ? (
                <>
                  <View style={styles.field}>
                    <Text style={styles.label}>{t("auth.identifierLabel")}</Text>
                    <View
                      style={[
                        styles.inputShell,
                        focusedField === "identifier" && styles.inputShellFocused,
                      ]}
                    >
                      <TextInput
                        accessibilityLabel={t("auth.identifierLabel")}
                        autoCapitalize="none"
                        autoComplete="username"
                        inputMode="email"
                        keyboardType="email-address"
                        onBlur={() => setFocusedField(undefined)}
                        onChangeText={(value) => {
                          setIdentifierText(value);
                          clearLocalError();
                        }}
                        onFocus={() => setFocusedField("identifier")}
                        onSubmitEditing={() => passwordInputRef.current?.focus()}
                        placeholder={t("auth.identifierPlaceholder")}
                        placeholderTextColor="rgba(255,255,255,0.34)"
                        returnKeyType="next"
                        style={styles.input}
                        textContentType="username"
                        value={identifierText}
                      />
                    </View>
                  </View>

                  <View style={styles.field}>
                    <Text style={styles.label}>{t("auth.passwordLabel")}</Text>
                    <View
                      style={[
                        styles.inputShell,
                        focusedField === "password" && styles.inputShellFocused,
                      ]}
                    >
                      <TextInput
                        ref={passwordInputRef}
                        accessibilityLabel={t("auth.passwordLabel")}
                        autoCapitalize="none"
                        autoComplete="password"
                        onBlur={() => setFocusedField(undefined)}
                        onChangeText={(value) => {
                          setPassword(value);
                          clearLocalError();
                        }}
                        onFocus={() => setFocusedField("password")}
                        onSubmitEditing={() => void handlePasswordSignIn()}
                        placeholder={t("auth.passwordPlaceholder")}
                        placeholderTextColor="rgba(255,255,255,0.34)"
                        returnKeyType="done"
                        secureTextEntry={!showPassword}
                        style={styles.input}
                        textContentType="password"
                        value={password}
                      />
                      <Pressable
                        accessibilityLabel={
                          showPassword ? t("auth.passwordHide") : t("auth.passwordShow")
                        }
                        accessibilityRole="button"
                        hitSlop={10}
                        onPress={() => setShowPassword((current) => !current)}
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

                  {termsCheckbox}
                </>
              ) : null}

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

              {step !== "code" ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={!canSubmitPrimary}
                  onPress={() => {
                    if (step === "identifier") void handleContinueIdentifier();
                    else void handlePasswordSignIn();
                  }}
                  style={({ pressed }) => (pressed && canSubmitPrimary ? styles.pressed : null)}
                >
                  <View
                    style={[
                      styles.primaryButton,
                      canSubmitPrimary ? styles.primaryButtonEnabled : styles.primaryButtonDisabled,
                    ]}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator
                        color="#FFFFFF"
                        size="small"
                        style={styles.buttonSpinner}
                      />
                    ) : null}
                    <Text
                      style={[
                        styles.primaryButtonText,
                        !canSubmitPrimary && styles.primaryButtonTextDisabled,
                      ]}
                    >
                      {step === "identifier" ? t("auth.continue") : t("auth.signIn")}
                    </Text>
                  </View>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    accessibilityRole="button"
                    disabled={!canSubmitPrimary}
                    onPress={() => void handleVerifyCode(code)}
                    style={({ pressed }) => (pressed && canSubmitPrimary ? styles.pressed : null)}
                  >
                    <View
                      style={[
                        styles.primaryButton,
                        canSubmitPrimary
                          ? styles.primaryButtonEnabled
                          : styles.primaryButtonDisabled,
                      ]}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator
                          color="#FFFFFF"
                          size="small"
                          style={styles.buttonSpinner}
                        />
                      ) : null}
                      <Text
                        style={[
                          styles.primaryButtonText,
                          !canSubmitPrimary && styles.primaryButtonTextDisabled,
                        ]}
                      >
                        {t("auth.verify")}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={styles.codeActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setStep("identifier");
                        setCode("");
                        clearLocalError();
                      }}
                      style={({ pressed }) => pressedStyle(pressed)}
                    >
                      <Text style={styles.quietLink}>{t("auth.codeEditIdentifier")}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={resendIn > 0 || sendingCode}
                      onPress={() => void handleResend()}
                      style={({ pressed }) => pressedStyle(pressed)}
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
              )}

              {step === "identifier" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    // Mirror web: keep whatever was typed and open the password
                    // step immediately — account stays editable there.
                    setPassword("");
                    setStep("password");
                    clearLocalError();
                    setTimeout(() => passwordInputRef.current?.focus(), 50);
                  }}
                  style={({ pressed }) => [styles.secondaryAction, pressedStyle(pressed)]}
                >
                  <Text style={styles.quietLink}>{t("auth.usePasswordInstead")}</Text>
                </Pressable>
              ) : null}

              {step === "password" ? (
                <View style={styles.passwordFooter}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setStep("identifier");
                      setPassword("");
                      clearLocalError();
                    }}
                    style={({ pressed }) => pressedStyle(pressed)}
                  >
                    <Text style={styles.quietLink}>{t("auth.useCodeInstead")}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    hitSlop={8}
                    onPress={() =>
                      router.replace({
                        pathname: "/forgot-password",
                        params: { identifier: identifierText.trim() },
                      })
                    }
                    style={({ pressed }) => pressedStyle(pressed)}
                  >
                    <Text style={styles.forgotLink}>{t("auth.forgotPassword")}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <LanguageSwitcher style={[styles.langSwitch, { top: safeAreaInsets.top + Spacing.two }]} />
      <Pressable
        accessibilityLabel={t("auth.skip")}
        accessibilityRole="button"
        hitSlop={10}
        onPress={() => skipAuthSheet(router)}
        style={({ pressed }) => [
          styles.skipButton,
          { top: safeAreaInsets.top + Spacing.two },
          pressed && styles.pressed,
        ]}
      >
        <SymbolView
          name={{ ios: "xmark", android: "close", web: "close" }}
          size={20}
          tintColor={theme.textSecondary}
        />
      </Pressable>
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
  skipButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    left: Spacing.four,
    position: "absolute",
    width: 40,
    zIndex: 10,
  },
  scrollContent: {
    alignItems: "center",
    flexGrow: 1,
  },
  page: {
    flex: 1,
    gap: Spacing.six,
    maxWidth: MaxContentWidth,
    width: "100%",
  },
  header: {
    alignItems: "center",
    gap: Spacing.three,
    paddingTop: Spacing.six,
  },
  logo: {
    height: 34,
    marginBottom: Spacing.two,
    width: 191,
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: theme.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  form: {
    gap: Spacing.four,
  },
  field: {
    gap: Spacing.two,
  },
  labelRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    color: theme.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  forgotLink: {
    color: theme.brand,
    fontSize: 13,
    fontWeight: "600",
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
  eyeButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    marginLeft: Spacing.two,
    width: 32,
  },
  codeActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.one,
  },
  codeHint: {
    color: theme.textSecondary,
    fontSize: 13,
    marginTop: Spacing.two,
  },
  quietLink: {
    color: theme.brand,
    fontSize: 14,
    fontWeight: "600",
  },
  quietLinkDisabled: {
    color: theme.textSecondary,
  },
  secondaryAction: {
    alignItems: "center",
    paddingVertical: Spacing.two,
  },
  passwordFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: Spacing.one,
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
  pressed: {
    opacity: 0.85,
  },
});
