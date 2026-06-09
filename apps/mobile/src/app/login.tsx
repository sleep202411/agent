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

import { useAuth } from "@/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { appEnv } from "@/config";
import { Colors, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTranslations } from "@/i18n";

type FieldName = "identifier" | "password";

const theme = Colors.dark;

const SITE_BASE_URL =
  appEnv.siteRegion === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";

function pressedStyle(pressed: boolean) {
  return { opacity: pressed ? 0.7 : 1 };
}

export default function LoginScreen() {
  const t = useTranslations();
  const auth = useAuth();
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const passwordInputRef = useRef<TextInput>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [focusedField, setFocusedField] = useState<FieldName | undefined>();
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();
  const isSubmitting = auth.status === "submitting";
  const hasCredentials = identifier.trim().length > 0 && password.length > 0;
  const canSubmit = hasCredentials && acceptedTerms && !isSubmitting;

  useEffect(() => {
    if (auth.status === "authenticated") {
      router.replace("/");
    }
  }, [auth.status, router]);

  function openSitePath(path: string) {
    void Linking.openURL(`${SITE_BASE_URL}${path}`).catch(() => {
      setLocalError(t("login.linkFailed"));
    });
  }

  function clearLocalError() {
    if (localError) setLocalError(undefined);
  }

  function handleIdentifierChange(value: string) {
    setIdentifier(value);
    clearLocalError();
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    clearLocalError();
  }

  async function handleSubmit() {
    if (!hasCredentials) {
      setLocalError(t("login.enterCredentials"));
      return;
    }
    if (!acceptedTerms) {
      setLocalError(t("login.termsRequired"));
      return;
    }
    setLocalError(undefined);
    try {
      await auth.signIn({ identifier, password });
      router.replace("/");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t("login.signInFailed"));
    }
  }

  const errorMessage = localError ?? auth.error;

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
              paddingTop: safeAreaInsets.top + Spacing.seven,
              paddingBottom: safeAreaInsets.bottom + Spacing.five,
              paddingLeft: Math.max(safeAreaInsets.left, Spacing.five),
              paddingRight: Math.max(safeAreaInsets.right, Spacing.five),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.page}>
            {/* Brand + heading */}
            <View style={styles.header}>
              <Image
                accessibilityLabel="FizzDragon"
                contentFit="contain"
                source={require("@/assets/images/fizzdragon-logo.png")}
                style={styles.logo}
              />
            </View>

            {/* Form */}
            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>{t("login.emailOrPhone")}</Text>
                <View
                  style={[
                    styles.inputShell,
                    focusedField === "identifier" && styles.inputShellFocused,
                  ]}
                >
                  <TextInput
                    accessibilityLabel={t("login.emailOrPhone")}
                    autoCapitalize="none"
                    autoComplete="username"
                    inputMode="email"
                    keyboardType="email-address"
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={handleIdentifierChange}
                    onFocus={() => setFocusedField("identifier")}
                    onSubmitEditing={() => passwordInputRef.current?.focus()}
                    placeholder={t("login.emailOrPhonePlaceholder")}
                    placeholderTextColor="rgba(255,255,255,0.34)"
                    returnKeyType="next"
                    style={styles.input}
                    textContentType="username"
                    value={identifier}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>{t("login.password")}</Text>
                  <Pressable
                    accessibilityRole="link"
                    hitSlop={8}
                    onPress={() => router.push("/forgot-password")}
                    style={({ pressed }) => pressedStyle(pressed)}
                  >
                    <Text style={styles.forgotLink}>{t("login.forgot")}</Text>
                  </Pressable>
                </View>
                <View
                  style={[
                    styles.inputShell,
                    focusedField === "password" && styles.inputShellFocused,
                  ]}
                >
                  <TextInput
                    ref={passwordInputRef}
                    accessibilityLabel={t("login.password")}
                    autoCapitalize="none"
                    autoComplete="password"
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={handlePasswordChange}
                    onFocus={() => setFocusedField("password")}
                    onSubmitEditing={handleSubmit}
                    placeholder={t("login.passwordPlaceholder")}
                    placeholderTextColor="rgba(255,255,255,0.34)"
                    returnKeyType="done"
                    secureTextEntry={!showPassword}
                    style={styles.input}
                    textContentType="password"
                    value={password}
                  />
                  <Pressable
                    accessibilityLabel={
                      showPassword ? t("login.hidePassword") : t("login.showPassword")
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
                    <Text
                      style={styles.termsLink}
                      onPress={() => openSitePath("/terms-of-service")}
                    >
                      {t("login.terms")}
                    </Text>
                    {t("login.and")}
                    <Text style={styles.termsLink} onPress={() => openSitePath("/privacy-policy")}>
                      {t("login.privacy")}
                    </Text>
                  </Text>
                </View>
              </Pressable>

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
                  {isSubmitting ? (
                    <ActivityIndicator color="#FFFFFF" size="small" style={styles.buttonSpinner} />
                  ) : null}
                  <Text
                    style={[
                      styles.primaryButtonText,
                      !canSubmit && styles.primaryButtonTextDisabled,
                    ]}
                  >
                    {isSubmitting ? t("login.signingIn") : t("login.signIn")}
                  </Text>
                </View>
              </Pressable>
            </View>

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>{t("login.newUser")}</Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => router.push("/register")}
                style={({ pressed }) => pressedStyle(pressed)}
              >
                <Text style={styles.footerLink}>{t("login.createAccount")}</Text>
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
    gap: Spacing.seven,
    maxWidth: MaxContentWidth,
    width: "100%",
  },
  // Header
  header: {
    alignItems: "center",
    paddingVertical: Spacing.six,
  },
  logo: {
    height: 34,
    width: 191,
  },
  // Form
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
  // Error
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
  // Terms
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
  // Primary button
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
  // Footer
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
