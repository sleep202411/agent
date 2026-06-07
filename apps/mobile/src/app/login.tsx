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
import { appEnv } from "@/config";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { t } from "@/i18n";

type FieldName = "identifier" | "password";

const SITE_BASE_URL =
  appEnv.siteRegion === "cn" ? "https://fizzdragon.fizzspace.cn" : "https://fizzdragon.com";

function pressedStyle(pressed: boolean) {
  return { opacity: pressed ? 0.72 : 1 };
}

export default function LoginScreen() {
  const auth = useAuth();
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
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
    const url = `${SITE_BASE_URL}${path}`;
    void Linking.openURL(url).catch(() => {
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
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Image
        contentFit="cover"
        source={require("@/assets/images/login-splash.png")}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.topScrim} />
      <View style={styles.bottomScrim} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: safeAreaInsets.bottom + Spacing.four,
              paddingLeft: Math.max(safeAreaInsets.left, Spacing.four),
              paddingRight: Math.max(safeAreaInsets.right, Spacing.four),
              paddingTop: safeAreaInsets.top + Spacing.three,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.page}>
            <View style={styles.topBar}>
              <View style={styles.appMark}>
                <Text style={styles.appMarkText}>FD</Text>
              </View>
              <View style={styles.regionBadge}>
                <View style={[styles.statusDot, { backgroundColor: theme.brand }]} />
                <Text style={styles.regionText}>{t("login.mobileStudio")}</Text>
              </View>
            </View>

            <View style={styles.heroSpacer} />

            <View style={[styles.formCard, { borderColor: theme.border }]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleGroup}>
                  <Text style={styles.eyebrow}>FizzDragon</Text>
                  <Text style={styles.title}>{t("login.title")}</Text>
                  <Text style={styles.subtitle}>{t("login.subtitle")}</Text>
                </View>
                <View style={styles.secureBadge}>
                  <SymbolView
                    name={{ ios: "lock.shield", android: "security", web: "security" }}
                    size={16}
                    tintColor="#FFFFFF"
                  />
                  <Text style={styles.secureText}>{t("login.secure")}</Text>
                </View>
              </View>

              <View style={styles.fields}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>{t("login.emailOrPhone")}</Text>
                  <View
                    style={[
                      styles.inputShell,
                      {
                        borderColor: focusedField === "identifier" ? theme.brand : theme.border,
                      },
                    ]}
                  >
                    <SymbolView
                      name={{ ios: "person", android: "person", web: "person" }}
                      size={18}
                      tintColor={
                        focusedField === "identifier" ? "#FFFFFF" : "rgba(255,255,255,0.62)"
                      }
                    />
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
                      placeholderTextColor="rgba(255,255,255,0.42)"
                      returnKeyType="next"
                      style={styles.input}
                      textContentType="username"
                      value={identifier}
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <View style={styles.fieldHeader}>
                    <Text style={styles.fieldLabel}>{t("login.password")}</Text>
                    <Pressable
                      accessibilityRole="link"
                      hitSlop={8}
                      onPress={() => openSitePath("/forgot-password")}
                      style={({ pressed }) => pressedStyle(pressed)}
                    >
                      <Text style={[styles.textButton, { color: theme.brand }]}>
                        {t("login.forgot")}
                      </Text>
                    </Pressable>
                  </View>
                  <View
                    style={[
                      styles.inputShell,
                      {
                        borderColor: focusedField === "password" ? theme.brand : theme.border,
                      },
                    ]}
                  >
                    <SymbolView
                      name={{ ios: "lock", android: "lock", web: "lock" }}
                      size={18}
                      tintColor={focusedField === "password" ? "#FFFFFF" : "rgba(255,255,255,0.62)"}
                    />
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
                      placeholderTextColor="rgba(255,255,255,0.42)"
                      returnKeyType="done"
                      secureTextEntry={!showPassword}
                      style={styles.input}
                      textContentType="password"
                      value={password}
                    />
                    <Pressable
                      accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                      accessibilityRole="button"
                      hitSlop={10}
                      onPress={() => setShowPassword((current) => !current)}
                      style={({ pressed }) => [styles.iconButton, pressedStyle(pressed)]}
                    >
                      <SymbolView
                        name={{
                          ios: showPassword ? "eye.slash" : "eye",
                          android: showPassword ? "visibility_off" : "visibility",
                          web: showPassword ? "visibility_off" : "visibility",
                        }}
                        size={18}
                        tintColor="rgba(255,255,255,0.68)"
                      />
                    </Pressable>
                  </View>
                </View>
              </View>

              {errorMessage ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[styles.errorPanel, { borderColor: theme.brand }]}
                >
                  <SymbolView
                    name={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
                    size={18}
                    tintColor={theme.brand}
                  />
                  <Text style={[styles.errorText, { color: theme.brand }]}>{errorMessage}</Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acceptedTerms }}
                onPress={() => {
                  setAcceptedTerms((current) => !current);
                  clearLocalError();
                }}
                style={({ pressed }) => [styles.termsRow, pressedStyle(pressed)]}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      backgroundColor: acceptedTerms ? theme.brand : "rgba(255,255,255,0.04)",
                      borderColor: acceptedTerms ? theme.brand : theme.border,
                    },
                  ]}
                >
                  {acceptedTerms ? (
                    <SymbolView
                      name={{ ios: "checkmark", android: "check", web: "check" }}
                      size={13}
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
                  {
                    backgroundColor: canSubmit ? theme.brand : "rgba(255,255,255,0.1)",
                    borderColor: canSubmit ? theme.brand : theme.border,
                  },
                  pressed && canSubmit ? styles.pressed : null,
                ]}
              >
                {isSubmitting ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                <Text style={[styles.primaryButtonText, !canSubmit && styles.disabledButtonText]}>
                  {isSubmitting ? t("login.signingIn") : t("login.signIn")}
                </Text>
              </Pressable>

              <View style={styles.secondaryRow}>
                <Text style={styles.secondaryText}>{t("login.newUser")}</Text>
                <Pressable
                  accessibilityRole="link"
                  hitSlop={8}
                  onPress={() => openSitePath("/register")}
                  style={({ pressed }) => pressedStyle(pressed)}
                >
                  <Text style={styles.secondaryLink}>{t("login.createAccount")}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  topScrim: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  bottomScrim: {
    bottom: 0,
    height: "58%",
    left: 0,
    position: "absolute",
    right: 0,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  scrollContent: {
    alignItems: "center",
    flexGrow: 1,
  },
  page: {
    flex: 1,
    justifyContent: "space-between",
    maxWidth: MaxContentWidth,
    minHeight: 790,
    width: "100%",
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  appMark: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 8,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  appMarkText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 20,
  },
  regionBadge: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 38,
    paddingHorizontal: Spacing.three,
  },
  statusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  regionText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
  },
  heroSpacer: {
    flex: 1,
    minHeight: 240,
  },
  formCard: {
    backgroundColor: "rgba(20,20,26,0.78)",
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.four,
    overflow: "hidden",
    padding: Spacing.four,
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: Spacing.three,
    justifyContent: "space-between",
  },
  cardTitleGroup: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  eyebrow: {
    color: "rgba(255,255,255,0.64)",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 36,
  },
  subtitle: {
    color: "rgba(255,255,255,0.66)",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  secureBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 36,
    paddingHorizontal: Spacing.three,
  },
  secureText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },
  fields: {
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.two,
  },
  fieldHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  fieldLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  textButton: {
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  inputShell: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.three,
    minHeight: 54,
    paddingHorizontal: Spacing.three,
  },
  input: {
    color: "#FFFFFF",
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    minHeight: 54,
    padding: 0,
  },
  iconButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  errorPanel: {
    alignItems: "flex-start",
    backgroundColor: "rgba(229,34,39,0.12)",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    padding: Spacing.three,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  termsRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: Spacing.three,
  },
  checkbox: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    marginTop: 1,
    width: 22,
  },
  termsText: {
    color: "rgba(255,255,255,0.62)",
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
  },
  termsLink: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  primaryButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: Spacing.four,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 22,
  },
  disabledButtonText: {
    color: "rgba(255,255,255,0.48)",
  },
  secondaryRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "center",
    minHeight: 28,
  },
  secondaryText: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  secondaryLink: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.72,
  },
});
