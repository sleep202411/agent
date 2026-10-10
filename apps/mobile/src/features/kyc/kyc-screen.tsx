import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Stack, useIsFocused } from "expo-router";
import { ActivityIndicator, Platform, Pressable, ScrollView, TextInput } from "react-native";
import { z } from "zod";
import { useAuth, useAuthGate, refreshCurrentUser } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { appEnv, webBaseUrl } from "@/config";
import { durableRecord } from "@/lib/durable-record";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { confirmKyc, loadKycStatus, readKycReturn, startKyc, type KycReceipt } from "./kyc-api";
import { KycMetadata, KycProvider } from "./kyc-provider";
const pendingSchema = z.object({ certifyId: z.string().min(1).optional() }).nullable();
export default function KycScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    focused = useIsFocused(),
    t = useTranslations(),
    theme = useTheme();
  const userId = String(auth.user?.id ?? auth.user?.userId ?? "");
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("kyc.title"),
          headerBackButtonDisplayMode: "minimal",
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
        }}
      />
      {appEnv.appRegion !== "cn" ? (
        <ThemedText>{t("kyc.cnOnlyBody")}</ThemedText>
      ) : auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" || !userId ? (
        <Pressable accessibilityRole="button" onPress={() => gate.openLogin()}>
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : focused ? (
        <KycSession
          key={`${userId}:${auth.generation}`}
          userId={userId}
          generation={auth.generation}
        />
      ) : null}
    </ScrollView>
  );
}
export function KycSession({ userId, generation }: { userId: string; generation: number }) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [storage] = useState(() => durableRecord("kyc", userId, "verification"));
  const [initial] = useState(() => {
    try {
      return { pending: pendingSchema.parse(JSON.parse(storage.read() || "null")), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [error, setError] = useState(initial.error);
  const [needsVerification, setNeedsVerification] = useState<boolean>(),
    [busy, setBusy] = useState(true),
    [name, setName] = useState(""),
    [number, setNumber] = useState("");
  const [metadata, setMetadata] = useState(""),
    [metadataError, setMetadataError] = useState(false),
    [metadataRevision, setMetadataRevision] = useState(0);
  const [provider, setProvider] = useState<KycReceipt>(),
    [providerRevision, setProviderRevision] = useState(0),
    [restart, setRestart] = useState(false);
  const owner = useRef<AbortController | null>(null),
    lock = useRef(false);
  const returnUrl = `${webBaseUrl}/${locale}/kyc`;
  useLayoutEffect(() => {
    const c = new AbortController();
    owner.current = c;
    return () => {
      c.abort();
      owner.current = null;
      lock.current = false;
    };
  }, []);
  const current = useCallback(
    (c: AbortController) =>
      owner.current === c && !c.signal.aborted && generation === getAuthGeneration(),
    [generation]
  );
  async function run(action: "status" | "start" | "confirm") {
    const c = owner.current;
    if (!c || !current(c) || lock.current) return;
    if (
      action === "start" &&
      (pending ||
        initial.error ||
        !metadata ||
        !name.trim() ||
        !/^\d{17}[\dXx]$/.test(number.trim()))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "start") {
        // Save uncertainty before dispatch; never persist name, ID number or SDK metadata.
        storage.write("{}");
        setPending({});
        const receipt = await startKyc(
          { userName: name, certNo: number, userId, metaInfo: metadata, returnUrl },
          generation,
          c.signal
        );
        if (!current(c)) return;
        const next = { certifyId: receipt.certifyId };
        storage.write(JSON.stringify(next));
        setPending(next);
        setName("");
        setNumber("");
        setProvider(receipt);
      } else {
        const passed =
          action === "confirm" && pending?.certifyId
            ? await confirmKyc(pending.certifyId, generation, c.signal)
            : !(await loadKycStatus(generation, c.signal)).needAuth;
        if (!current(c)) return;
        if (passed) {
          await refreshCurrentUser();
          if (!current(c)) return;
          storage.write("null");
          setPending(null);
          setProvider(undefined);
          setNeedsVerification(false);
        } else {
          setNeedsVerification(true);
          if (action === "confirm") setError(t("kyc.resultNotPassed"));
        }
      }
    } catch (e) {
      if (current(c)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (current(c)) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    const c = owner.current!;
    lock.current = true;
    void loadKycStatus(generation, c.signal)
      .then(async (value) => {
        if (!current(c)) return;
        if (!value.needAuth) {
          await refreshCurrentUser();
          if (!current(c)) return;
          storage.write("null");
          setPending(null);
        }
        setNeedsVerification(value.needAuth);
      })
      .catch((e) => {
        if (current(c)) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (current(c)) {
          lock.current = false;
          setBusy(false);
        }
      });
  }, [generation, storage, current]);
  const input = (
    label: string,
    value: string,
    change: (value: string) => void,
    maxLength: number
  ) => (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={theme.textSecondary}
      value={value}
      onChangeText={change}
      editable={!busy}
      maxLength={maxLength}
      autoCorrect={false}
      autoCapitalize="none"
      style={{
        padding: 12,
        borderRadius: 8,
        color: theme.text,
        backgroundColor: theme.backgroundElement,
      }}
    />
  );
  return (
    <>
      <ThemedText type="small">{t("kyc.subtitle")}</ThemedText>
      {busy && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {needsVerification === false ? <ThemedText>{t("kyc.completedTitle")}</ThemedText> : null}
      <KycAction
        label={t("kyc.checkStatus")}
        onPress={() => void run(pending?.certifyId ? "confirm" : "status")}
        disabled={busy}
      />
      {pending && (
        <>
          <ThemedText type="small">{t("kyc.pendingRecovery")}</ThemedText>
          <KycAction label={t("kyc.restart")} onPress={() => setRestart(true)} disabled={busy} />
          {restart && (
            <>
              <ThemedText type="small">{t("kyc.restartHint")}</ThemedText>
              <KycAction
                label={t("common.cancel")}
                onPress={() => setRestart(false)}
                disabled={busy}
              />
              <KycAction
                label={t("kyc.restart")}
                onPress={() => {
                  try {
                    storage.write("null");
                    setPending(null);
                    setProvider(undefined);
                    setRestart(false);
                    setMetadata("");
                    setMetadataRevision((v) => v + 1);
                  } catch (e) {
                    setError(String(e));
                  }
                }}
                disabled={busy}
              />
            </>
          )}
        </>
      )}
      {provider && (
        <>
          <KycProvider
            key={providerRevision}
            uri={provider.certifyUrl}
            returnUrl={returnUrl}
            title={t("kyc.stepAliyun")}
            onError={() => setError(t("kyc.providerFailed"))}
            onReturn={(url) => {
              if (generation !== getAuthGeneration()) return;
              try {
                const result = readKycReturn(url, returnUrl, provider.certifyId);
                if (!result) throw Error(t("kyc.resultInvalid"));
                setProvider(undefined);
                if (result.code === "1000") void run("confirm");
                else
                  setError(
                    result.code === "1003"
                      ? t("kyc.cancelled")
                      : result.reason || t("kyc.resultNotPassed")
                  );
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
          {Platform.OS !== "web" && (
            <KycAction
              label={t("kyc.retry")}
              onPress={() => {
                setError("");
                setProviderRevision((v) => v + 1);
              }}
              disabled={busy}
            />
          )}
          <KycAction
            label={t("common.cancel")}
            onPress={() => {
              setProvider(undefined);
              setError(t("kyc.cancelled"));
            }}
            disabled={busy}
          />
        </>
      )}
      {needsVerification === true && !pending && !initial.error && (
        <>
          <KycMetadata
            key={metadataRevision}
            onReady={setMetadata}
            onError={() => setMetadataError(true)}
          />
          <ThemedText type="small">
            {t(
              metadataError
                ? "kyc.aliyunModuleError"
                : metadata
                  ? "kyc.aliyunModuleReady"
                  : "kyc.aliyunModuleLoading"
            )}
          </ThemedText>
          {metadataError && (
            <KycAction
              label={t("kyc.metaRefresh")}
              disabled={busy}
              onPress={() => {
                setMetadata("");
                setMetadataError(false);
                setMetadataRevision((v) => v + 1);
              }}
            />
          )}
          {input(t("kyc.nameLabel"), name, setName, 100)}
          {input(t("kyc.certNoLabel"), number, setNumber, 18)}
          <KycAction
            label={t("kyc.start")}
            onPress={() => void run("start")}
            disabled={busy || !metadata || !name.trim() || !/^\d{17}[\dXx]$/.test(number.trim())}
          />
        </>
      )}
    </>
  );
}

function KycAction({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <ThemedText type="small">{label}</ThemedText>
    </Pressable>
  );
}
