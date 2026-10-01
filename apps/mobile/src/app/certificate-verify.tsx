import { useEffect, useRef, useState } from "react";
import { Stack } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations, type MessageKey } from "@/i18n";
import {
  isCertificateNumber,
  normalizeCertificateNumber,
  verifyCertificate,
  type VerificationResult,
} from "@/features/certificates/verify-api";

export default function CertificateVerifyScreen() {
  const t = useTranslations(),
    theme = useTheme(),
    locale = useLocale();
  const active = useScreenActive();
  const [number, setNumber] = useState("");
  const [result, setResult] = useState<VerificationResult>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<AbortController>();
  const busy = !!pending && !pending.signal.aborted && active;
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    return () => {
      request.current?.abort();
      request.current = undefined;
    };
  }, [active]);
  const label = (key: string) => t(`certificateVerification.${key}` as MessageKey);
  const submit = async () => {
    if (!active || request.current) return;
    const normalized = normalizeCertificateNumber(number);
    setNumber(normalized);
    setResult(undefined);
    setError(undefined);
    if (!isCertificateNumber(normalized)) {
      setError(label(normalized ? "formatError" : "emptyError"));
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(controller);
    try {
      const next = await verifyCertificate(normalized, controller.signal);
      if (!controller.signal.aborted) setResult(next);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : label("requestError"));
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setPending(undefined);
      }
    }
  };
  const cert = result?.certificate;
  const state = result?.status === "not_found" ? "notFound" : result?.status;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: label("toolTitle"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      <ThemedText type="small">{label("description")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label("privacyNote")}
      </ThemedText>
      <ThemedText type="smallBold">{label("inputLabel")}</ThemedText>
      <TextInput
        accessibilityLabel={label("inputLabel")}
        value={number}
        editable={!busy}
        maxLength={32}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={label("inputPlaceholder")}
        placeholderTextColor={theme.textSecondary}
        onChangeText={(value) => {
          setNumber(value);
          setResult(undefined);
          setError(undefined);
        }}
        onSubmitEditing={() => void submit()}
        style={{
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          padding: 12,
          borderRadius: 8,
        }}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy || !active}
        onPress={() => void submit()}
        style={{ padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
      >
        <ThemedText type="smallBold">{label(busy ? "verifying" : "verify")}</ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {state && (
        <View
          style={{
            gap: 12,
            padding: 16,
            borderRadius: 8,
            backgroundColor: theme.backgroundElement,
          }}
        >
          <ThemedText type="smallBold">{label(`${state}Title`)}</ThemedText>
          <ThemedText type="small">{label(`${state}Body`)}</ThemedText>
          {cert && (
            <>
              {[
                ["titleLabel", cert.title],
                ["issuerLabel", cert.issuer],
                ["certNoLabel", cert.certNo],
                ["issuedAtLabel", new Date(cert.issuedAt).toLocaleDateString(locale)],
                ...(cert.revokedAt
                  ? [["revokedAtLabel", new Date(cert.revokedAt).toLocaleDateString(locale)]]
                  : []),
                ...(cert.revokedReason ? [["revokedReasonLabel", cert.revokedReason]] : []),
              ].map(([key, value]) => (
                <ThemedText key={key} type="small">
                  {label(key)}: {value}
                </ThemedText>
              ))}
              {cert.imageUrl?.startsWith("https://") && (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => {
                    void WebBrowser.openBrowserAsync(cert.imageUrl!).catch((cause: unknown) =>
                      setError(cause instanceof Error ? cause.message : label("requestError"))
                    );
                  }}
                >
                  <ThemedText type="smallBold">{label("viewImage")}</ThemedText>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
}
