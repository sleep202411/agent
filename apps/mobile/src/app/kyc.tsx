import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { AliyunMetaWebView } from "@/components/aliyun-meta-webview";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { isChinaRegion } from "@/config";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import {
  certifyInit,
  certifyQuery,
  getKycUserId,
  isBackendCertifyPassed,
  isKycVerified,
  parseAliyunCertifyResponse,
} from "@/data/kyc-api";
import { useTheme } from "@/hooks/use-theme";
import { t } from "@/i18n";

type FieldName = "name" | "certNo";
type MetaStatus = "loading" | "ready" | "error";
type FlowPhase = "idle" | "init" | "browser" | "query" | "success" | "error" | "cancelled";
type AppSymbol = SymbolViewProps["name"];

const ID_CARD_REGEX =
  /(^[1-9]\d{5}(18|19|20)\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}[0-9Xx]$)|(^[1-9]\d{5}\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}$)/;

function pressedStyle(pressed: boolean) {
  return { opacity: pressed ? 0.72 : 1 };
}

function createFlowId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function getQueryParam(url: string, key: string) {
  const [, queryWithHash = ""] = url.split("?");
  const [query = ""] = queryWithHash.split("#");
  return new URLSearchParams(query).get(key);
}

function iconForPhase(phase: FlowPhase): AppSymbol {
  if (phase === "success") return { ios: "checkmark.seal", android: "verified", web: "verified" };
  if (phase === "error" || phase === "cancelled") {
    return { ios: "exclamationmark.triangle", android: "warning", web: "warning" };
  }
  return { ios: "checkmark.shield", android: "verified_user", web: "verified_user" };
}

export default function KycScreen() {
  const auth = useAuth();
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  const certNoInputRef = useRef<TextInput>(null);

  const [certNo, setCertNo] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [focusedField, setFocusedField] = useState<FieldName | undefined>();
  const [legalName, setLegalName] = useState("");
  const [metaInfo, setMetaInfo] = useState<string | undefined>();
  const [metaReloadKey, setMetaReloadKey] = useState(0);
  const [metaStatus, setMetaStatus] = useState<MetaStatus>("loading");
  const [phase, setPhase] = useState<FlowPhase>("idle");

  const alreadyVerified = isKycVerified(auth.user);
  const userId = getKycUserId(auth.user);
  const isBusy = phase === "init" || phase === "browser" || phase === "query";
  const canSubmit =
    isChinaRegion &&
    auth.status === "authenticated" &&
    !alreadyVerified &&
    metaStatus === "ready" &&
    !isBusy;

  useEffect(() => {
    if (auth.status === "anonymous") {
      router.replace("/login");
    }
  }, [auth.status, router]);

  const statusCopy = useMemo(() => {
    if (!isChinaRegion) return { label: t("kyc.cnOnlyTitle"), detail: t("kyc.cnOnlyBody") };
    if (alreadyVerified) {
      return { label: t("kyc.accountVerified"), detail: t("kyc.completedBody") };
    }
    if (phase === "init") return { label: t("kyc.submitting"), detail: t("kyc.stepBackend") };
    if (phase === "browser") return { label: t("kyc.browserOpening"), detail: t("kyc.stepAliyun") };
    if (phase === "query") return { label: t("kyc.pending"), detail: t("kyc.stepBackend") };
    if (phase === "success")
      return { label: t("kyc.completedTitle"), detail: t("kyc.completedBody") };
    if (phase === "cancelled")
      return { label: t("kyc.cancelled"), detail: t("kyc.browserCancelled") };
    if (phase === "error")
      return { label: t("kyc.errorTitle"), detail: error ?? t("kyc.initFailed") };
    if (metaStatus === "ready") {
      return { label: t("kyc.accountUnverified"), detail: t("kyc.aliyunModuleReady") };
    }
    if (metaStatus === "error") {
      return { label: t("kyc.accountUnverified"), detail: t("kyc.aliyunModuleError") };
    }
    return { label: t("kyc.collectingMeta"), detail: t("kyc.aliyunModuleLoading") };
  }, [alreadyVerified, error, metaStatus, phase]);

  function resetMetaInfo() {
    setError(undefined);
    setMetaInfo(undefined);
    setMetaStatus("loading");
    setMetaReloadKey((current) => current + 1);
  }

  function validateForm() {
    const trimmedName = legalName.trim();
    const trimmedCertNo = certNo.trim();

    if (trimmedName.length < 2) {
      return t("kyc.nameRequired");
    }
    if (!ID_CARD_REGEX.test(trimmedCertNo)) {
      return t("kyc.certNoRequired");
    }
    if (!metaInfo) {
      return metaStatus === "error" ? t("kyc.aliyunModuleError") : t("kyc.aliyunModuleLoading");
    }
    if (!userId) {
      return t("kyc.initFailed");
    }

    return undefined;
  }

  async function handleSubmit() {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      setPhase("error");
      return;
    }

    setError(undefined);
    setPhase("init");

    const flowId = createFlowId();
    const callbackBaseUrl = Linking.createURL("kyc/callback");
    const returnUrl = Linking.createURL(`kyc/callback/${flowId}`);

    try {
      const initResult = await certifyInit({
        certNo: certNo.trim(),
        metaInfo: metaInfo as string,
        returnUrl,
        userId: userId as string | number,
        userName: legalName.trim(),
      });

      if (!initResult.certifyUrl || !initResult.certifyId) {
        throw new Error(t("kyc.initFailed"));
      }

      setPhase("browser");
      const browserResult = await WebBrowser.openAuthSessionAsync(
        initResult.certifyUrl,
        callbackBaseUrl,
        {
          controlsColor: theme.text,
          dismissButtonStyle: "cancel",
          preferEphemeralSession: false,
          toolbarColor: theme.background,
        }
      );

      if (browserResult.type !== "success") {
        setError(t("kyc.browserCancelled"));
        setPhase("cancelled");
        return;
      }

      const responseParam = getQueryParam(browserResult.url, "response");
      if (!browserResult.url.includes(flowId)) {
        throw new Error(t("kyc.resultInvalid"));
      }
      if (!responseParam) {
        throw new Error(t("kyc.resultInvalid"));
      }

      const parsedResponse = parseAliyunCertifyResponse(responseParam);
      const code = String(parsedResponse.code ?? "");
      if (code === "1003") {
        setError(t("kyc.browserCancelled"));
        setPhase("cancelled");
        return;
      }
      if (code !== "1000") {
        throw new Error(
          parsedResponse.reason || parsedResponse.message || `${t("kyc.resultNotPassed")} (${code})`
        );
      }

      setPhase("query");
      const certifyId = parsedResponse.extInfo?.certifyId ?? initResult.certifyId;
      const queryResult = await certifyQuery(certifyId);
      if (!isBackendCertifyPassed(queryResult)) {
        throw new Error(t("kyc.queryFailed"));
      }

      await auth.refreshCurrentUser();
      setPhase("success");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("kyc.initFailed"));
      setPhase("error");
    }
  }

  function renderModuleStatus() {
    const tint =
      metaStatus === "ready"
        ? "#16A34A"
        : metaStatus === "error"
          ? theme.brand
          : theme.textSecondary;
    const label =
      metaStatus === "ready"
        ? t("kyc.aliyunModuleReady")
        : metaStatus === "error"
          ? t("kyc.aliyunModuleError")
          : t("kyc.aliyunModuleLoading");

    return (
      <View style={styles.moduleStatus}>
        {metaStatus === "loading" ? (
          <ActivityIndicator color={theme.textSecondary} size="small" />
        ) : (
          <SymbolView
            name={
              metaStatus === "ready"
                ? { ios: "checkmark.circle", android: "check_circle", web: "check_circle" }
                : { ios: "exclamationmark.circle", android: "error", web: "error" }
            }
            size={18}
            tintColor={tint}
          />
        )}
        <ThemedText type="small" themeColor="textSecondary" style={styles.moduleText}>
          {label}
        </ThemedText>
        {metaStatus === "error" ? (
          <Pressable
            accessibilityRole="button"
            onPress={resetMetaInfo}
            style={({ pressed }) => [styles.inlineButton, pressedStyle(pressed)]}
          >
            <ThemedText type="smallBold" style={{ color: theme.brand }}>
              {t("kyc.metaRefresh")}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.root, { backgroundColor: theme.background }]}
    >
      {isChinaRegion && !alreadyVerified ? (
        <AliyunMetaWebView
          onError={(message) => {
            setMetaStatus("error");
            setError(message || t("kyc.aliyunModuleError"));
          }}
          onReady={(nextMetaInfo) => {
            setMetaInfo(nextMetaInfo);
            setMetaStatus("ready");
            if (phase === "error" && error === t("kyc.aliyunModuleError")) {
              setError(undefined);
              setPhase("idle");
            }
          }}
          reloadKey={metaReloadKey}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: safeAreaInsets.bottom + Spacing.five,
            paddingLeft: Math.max(safeAreaInsets.left, Spacing.four),
            paddingRight: Math.max(safeAreaInsets.right, Spacing.four),
            paddingTop: safeAreaInsets.top + Spacing.three,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.page}>
          <View style={styles.headerRow}>
            <Pressable
              accessibilityLabel={t("kyc.backToMine")}
              accessibilityRole="button"
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: theme.backgroundElement },
                pressedStyle(pressed),
              ]}
            >
              <SymbolView
                name={{ ios: "chevron.left", android: "arrow_back", web: "arrow_back" }}
                size={20}
                tintColor={theme.text}
              />
            </Pressable>
            <View style={styles.headerCopy}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                FizzDragon CN
              </ThemedText>
              <ThemedText type="subtitle" style={styles.title}>
                {t("kyc.title")}
              </ThemedText>
            </View>
          </View>

          <ThemedText type="default" themeColor="textSecondary" style={styles.subtitle}>
            {t("kyc.subtitle")}
          </ThemedText>

          <ThemedView type="backgroundElement" style={styles.statusPanel}>
            <View style={[styles.statusIcon, { backgroundColor: theme.backgroundSelected }]}>
              <SymbolView name={iconForPhase(phase)} size={22} tintColor={theme.text} />
            </View>
            <View style={styles.statusCopy}>
              <ThemedText type="smallBold">{statusCopy.label}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {statusCopy.detail}
              </ThemedText>
            </View>
          </ThemedView>

          {!isChinaRegion ? (
            <ThemedView type="backgroundElement" style={styles.noticePanel}>
              <ThemedText type="smallBold">{t("kyc.cnOnlyTitle")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t("kyc.cnOnlyBody")}
              </ThemedText>
            </ThemedView>
          ) : null}

          {alreadyVerified || phase === "success" ? (
            <ThemedView type="backgroundElement" style={styles.successPanel}>
              <View style={[styles.successMark, { backgroundColor: "#16A34A" }]}>
                <SymbolView
                  name={{ ios: "checkmark", android: "check", web: "check" }}
                  size={20}
                  tintColor="#FFFFFF"
                />
              </View>
              <View style={styles.statusCopy}>
                <ThemedText type="smallBold">{t("kyc.completedTitle")}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t("kyc.completedBody")}
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: theme.border },
                  pressedStyle(pressed),
                ]}
              >
                <ThemedText type="smallBold">{t("kyc.backToMine")}</ThemedText>
              </Pressable>
            </ThemedView>
          ) : (
            <>
              <ThemedView type="backgroundElement" style={styles.formPanel}>
                <View style={styles.formHeader}>
                  <ThemedText type="smallBold">{t("kyc.formTitle")}</ThemedText>
                  <View style={[styles.stepBadge, { borderColor: theme.border }]}>
                    <ThemedText type="code" themeColor="textSecondary">
                      1 / 3
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.field}>
                  <ThemedText type="smallBold">{t("kyc.nameLabel")}</ThemedText>
                  <View
                    style={[
                      styles.inputShell,
                      {
                        backgroundColor: theme.backgroundSelected,
                        borderColor: focusedField === "name" ? theme.brand : theme.border,
                      },
                    ]}
                  >
                    <SymbolView
                      name={{ ios: "person", android: "person", web: "person" }}
                      size={18}
                      tintColor={focusedField === "name" ? theme.text : theme.textSecondary}
                    />
                    <TextInput
                      accessibilityLabel={t("kyc.nameLabel")}
                      autoCapitalize="none"
                      autoComplete="name"
                      editable={!isBusy}
                      onBlur={() => setFocusedField(undefined)}
                      onChangeText={(value) => {
                        setLegalName(value);
                        if (error) setError(undefined);
                        if (phase === "error" || phase === "cancelled") setPhase("idle");
                      }}
                      onFocus={() => setFocusedField("name")}
                      onSubmitEditing={() => certNoInputRef.current?.focus()}
                      placeholder={t("kyc.namePlaceholder")}
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="next"
                      style={[styles.input, { color: theme.text }]}
                      value={legalName}
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <ThemedText type="smallBold">{t("kyc.certNoLabel")}</ThemedText>
                  <View
                    style={[
                      styles.inputShell,
                      {
                        backgroundColor: theme.backgroundSelected,
                        borderColor: focusedField === "certNo" ? theme.brand : theme.border,
                      },
                    ]}
                  >
                    <SymbolView
                      name={{ ios: "number", android: "pin", web: "pin" }}
                      size={18}
                      tintColor={focusedField === "certNo" ? theme.text : theme.textSecondary}
                    />
                    <TextInput
                      ref={certNoInputRef}
                      accessibilityLabel={t("kyc.certNoLabel")}
                      autoCapitalize="characters"
                      editable={!isBusy}
                      keyboardType="numbers-and-punctuation"
                      maxLength={18}
                      onBlur={() => setFocusedField(undefined)}
                      onChangeText={(value) => {
                        setCertNo(value.replace(/\s/g, ""));
                        if (error) setError(undefined);
                        if (phase === "error" || phase === "cancelled") setPhase("idle");
                      }}
                      onFocus={() => setFocusedField("certNo")}
                      onSubmitEditing={handleSubmit}
                      placeholder={t("kyc.certNoPlaceholder")}
                      placeholderTextColor={theme.textSecondary}
                      returnKeyType="done"
                      style={[styles.input, { color: theme.text }]}
                      value={certNo}
                    />
                  </View>
                </View>

                {renderModuleStatus()}
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.noticePanel}>
                <View style={styles.noticeIcon}>
                  <SymbolView
                    name={{ ios: "lock.shield", android: "security", web: "security" }}
                    size={18}
                    tintColor={theme.textSecondary}
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary" style={styles.noticeText}>
                  {t("kyc.openExternalNotice")}
                </ThemedText>
              </ThemedView>

              {error ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.errorPanel,
                    { backgroundColor: "rgba(229,34,39,0.12)", borderColor: theme.brand },
                  ]}
                >
                  <SymbolView
                    name={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
                    size={18}
                    tintColor={theme.brand}
                  />
                  <ThemedText type="smallBold" style={[styles.errorText, { color: theme.brand }]}>
                    {error}
                  </ThemedText>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                disabled={!canSubmit}
                onPress={handleSubmit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: canSubmit ? theme.brand : theme.backgroundSelected,
                    borderColor: canSubmit ? theme.brand : theme.border,
                  },
                  pressed && canSubmit ? styles.pressed : null,
                ]}
              >
                {isBusy ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
                <ThemedText
                  type="smallBold"
                  style={{ color: canSubmit || isBusy ? "#FFFFFF" : theme.textSecondary }}
                >
                  {isBusy
                    ? phase === "browser"
                      ? t("kyc.browserOpening")
                      : t("kyc.submitting")
                    : phase === "error" || phase === "cancelled"
                      ? t("kyc.retry")
                      : t("kyc.start")}
                </ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    alignItems: "center",
    flexGrow: 1,
  },
  page: {
    gap: Spacing.four,
    maxWidth: MaxContentWidth,
    width: "100%",
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.three,
    minHeight: 56,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  headerCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
  },
  subtitle: {
    maxWidth: 390,
  },
  statusPanel: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.three,
    padding: Spacing.three,
  },
  statusIcon: {
    alignItems: "center",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  statusCopy: {
    flex: 1,
    gap: Spacing.half,
    minWidth: 0,
  },
  formPanel: {
    borderRadius: 8,
    gap: Spacing.four,
    padding: Spacing.four,
  },
  formHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 28,
  },
  stepBadge: {
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 1,
    minHeight: 28,
    paddingHorizontal: Spacing.two,
    justifyContent: "center",
  },
  field: {
    gap: Spacing.two,
  },
  inputShell: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.three,
    minHeight: 54,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    minHeight: 54,
    padding: 0,
  },
  moduleStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.two,
    minHeight: 36,
  },
  moduleText: {
    flex: 1,
    minWidth: 0,
  },
  inlineButton: {
    minHeight: 32,
    justifyContent: "center",
  },
  noticePanel: {
    alignItems: "flex-start",
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.three,
    padding: Spacing.three,
  },
  noticeIcon: {
    height: 22,
    justifyContent: "center",
  },
  noticeText: {
    flex: 1,
  },
  successPanel: {
    alignItems: "center",
    borderRadius: 8,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  successMark: {
    alignItems: "center",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  secondaryButton: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.four,
    width: "100%",
  },
  errorPanel: {
    alignItems: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.two,
    padding: Spacing.three,
  },
  errorText: {
    flex: 1,
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
  pressed: {
    opacity: 0.72,
  },
});
