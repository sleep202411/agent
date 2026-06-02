import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth";
import { appEnv } from "@/config";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

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
      setLocalError("Unable to open this link. Try again from the web studio.");
    });
  }

  function handleIdentifierChange(value: string) {
    setIdentifier(value);
    if (localError) setLocalError(undefined);
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    if (localError) setLocalError(undefined);
  }

  async function handleSubmit() {
    if (!hasCredentials) {
      setLocalError("Enter your email or phone and password.");
      return;
    }

    if (!acceptedTerms) {
      setLocalError("Please accept the terms before signing in.");
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

  const errorMessage = localError ?? auth.error;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-canvas"
    >
      <ScrollView
        className="bg-canvas"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          alignItems: "center",
          flexGrow: 1,
          justifyContent: "center",
          paddingBottom: safeAreaInsets.bottom + Spacing.five,
          paddingLeft: Math.max(safeAreaInsets.left, Spacing.four),
          paddingRight: Math.max(safeAreaInsets.right, Spacing.four),
          paddingTop: safeAreaInsets.top + Spacing.five,
        }}
      >
        <View className="w-full gap-4" style={{ maxWidth: MaxContentWidth }}>
          <View className="gap-6 pt-2">
            <View className="flex-row items-center justify-between">
              <View className="h-12 w-12 items-center justify-center rounded-md bg-brand-500">
                <Text className="text-lg font-bold leading-6 text-white">FD</Text>
              </View>
              <View className="rounded-md bg-surface px-3 py-2">
                <Text className="font-mono text-xs font-medium uppercase tracking-normal text-ink-muted">
                  Mobile Studio
                </Text>
              </View>
            </View>

            <View className="gap-2">
              <Text className="text-sm font-bold leading-5 text-ink-muted">FizzDragon</Text>
              <Text className="text-[40px] font-semibold leading-[44px] text-ink">Sign in</Text>
              <Text className="max-w-[360px] text-[15px] font-medium leading-[22px] text-ink-muted">
                Sync your projects, credits, productions, and creator profile with the web studio.
              </Text>
            </View>
          </View>

          <View className="gap-4 rounded-md bg-surface p-4">
            <View className="flex-row items-center justify-between gap-3">
              <View>
                <Text className="text-sm font-bold leading-5 text-ink">Account access</Text>
                <Text className="text-sm font-medium leading-5 text-ink-muted">
                  Email or phone sign-in
                </Text>
              </View>
              <View className="flex-row items-center gap-2 rounded-md border border-line px-3 py-2">
                <View className="h-[7px] w-[7px] rounded-full bg-brand-500" />
                <Text className="font-mono text-xs font-medium uppercase tracking-normal text-ink-muted">
                  Secure
                </Text>
              </View>
            </View>

            <View className="gap-4">
              <View className="gap-2">
                <Text className="text-sm font-bold leading-5 text-ink">Email or phone</Text>
                <View
                  className={[
                    "min-h-[52px] flex-row items-center gap-3 rounded-md border bg-surface-muted px-3",
                    focusedField === "identifier" ? "border-brand-500" : "border-line",
                  ].join(" ")}
                >
                  <SymbolView
                    name={{ ios: "person", android: "person", web: "person" }}
                    size={18}
                    tintColor={focusedField === "identifier" ? theme.text : theme.textSecondary}
                  />
                  <TextInput
                    accessibilityLabel="Email or phone"
                    autoCapitalize="none"
                    autoComplete="username"
                    className="min-h-[52px] flex-1 p-0 text-base font-semibold text-ink"
                    inputMode="email"
                    keyboardType="email-address"
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={handleIdentifierChange}
                    onFocus={() => setFocusedField("identifier")}
                    onSubmitEditing={() => passwordInputRef.current?.focus()}
                    placeholder="Email or phone number"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="next"
                    textContentType="username"
                    value={identifier}
                  />
                </View>
              </View>

              <View className="gap-2">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-bold leading-5 text-ink">Password</Text>
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => openSitePath("/forgot-password")}
                    style={({ pressed }) => pressedStyle(pressed)}
                  >
                    <Text className="text-sm font-bold leading-5 text-brand-500">Forgot?</Text>
                  </Pressable>
                </View>
                <View
                  className={[
                    "min-h-[52px] flex-row items-center gap-3 rounded-md border bg-surface-muted px-3",
                    focusedField === "password" ? "border-brand-500" : "border-line",
                  ].join(" ")}
                >
                  <SymbolView
                    name={{ ios: "lock", android: "lock", web: "lock" }}
                    size={18}
                    tintColor={focusedField === "password" ? theme.text : theme.textSecondary}
                  />
                  <TextInput
                    ref={passwordInputRef}
                    accessibilityLabel="Password"
                    autoCapitalize="none"
                    autoComplete="password"
                    className="min-h-[52px] flex-1 p-0 text-base font-semibold text-ink"
                    onBlur={() => setFocusedField(undefined)}
                    onChangeText={handlePasswordChange}
                    onFocus={() => setFocusedField("password")}
                    onSubmitEditing={handleSubmit}
                    placeholder="Password"
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
                    secureTextEntry={!showPassword}
                    textContentType="password"
                    value={password}
                  />
                  <Pressable
                    accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                    accessibilityRole="button"
                    className="h-9 w-9 items-center justify-center"
                    hitSlop={10}
                    onPress={() => setShowPassword((current) => !current)}
                    style={({ pressed }) => pressedStyle(pressed)}
                  >
                    <SymbolView
                      name={{
                        ios: showPassword ? "eye.slash" : "eye",
                        android: showPassword ? "visibility_off" : "visibility",
                        web: showPassword ? "visibility_off" : "visibility",
                      }}
                      size={18}
                      tintColor={theme.textSecondary}
                    />
                  </Pressable>
                </View>
              </View>
            </View>

            {errorMessage && (
              <View
                accessibilityLiveRegion="polite"
                className="flex-row items-start gap-2 rounded-md border border-brand-500/30 bg-brand-500/10 p-3"
              >
                <SymbolView
                  name={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
                  size={18}
                  tintColor={theme.brand}
                />
                <Text className="flex-1 text-sm font-bold leading-5 text-brand-500">
                  {errorMessage}
                </Text>
              </View>
            )}

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedTerms }}
              className="flex-row items-start gap-3"
              onPress={() => {
                setAcceptedTerms((current) => !current);
                if (localError) setLocalError(undefined);
              }}
              style={({ pressed }) => pressedStyle(pressed)}
            >
              <View
                className={[
                  "mt-px h-5 w-5 items-center justify-center rounded-sm border",
                  acceptedTerms ? "border-brand-500 bg-brand-500" : "border-line bg-transparent",
                ].join(" ")}
              >
                {acceptedTerms && (
                  <SymbolView
                    name={{ ios: "checkmark", android: "check", web: "check" }}
                    size={13}
                    tintColor="#FFFFFF"
                  />
                )}
              </View>
              <Text className="flex-1 text-xs font-medium leading-[18px] text-ink-muted">
                I have read and agree to the{" "}
                <Text
                  className="font-bold text-ink"
                  onPress={() => openSitePath("/terms-of-service")}
                >
                  Terms
                </Text>{" "}
                and{" "}
                <Text
                  className="font-bold text-ink"
                  onPress={() => openSitePath("/privacy-policy")}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              className={[
                "min-h-[52px] items-center justify-center rounded-md border",
                canSubmit ? "border-brand-500 bg-brand-500" : "border-line bg-surface-muted",
              ].join(" ")}
              disabled={!canSubmit}
              onPress={handleSubmit}
              style={({ pressed }) => pressedStyle(pressed)}
            >
              <Text
                className={[
                  "text-base font-bold leading-[22px]",
                  canSubmit ? "text-white" : "text-ink-muted",
                ].join(" ")}
              >
                {isSubmitting ? "Signing in" : "Sign in"}
              </Text>
            </Pressable>
          </View>

          <View className="min-h-8 flex-row items-center justify-center gap-2">
            <Text className="text-sm font-medium leading-5 text-ink-muted">New to FizzDragon?</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => openSitePath("/register")}
              style={({ pressed }) => pressedStyle(pressed)}
            >
              <Text className="text-sm font-bold leading-5 text-ink">Create account</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
