import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, TextInput, View } from "react-native";
import { uuid } from "expo-modules-core";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { isChinaRegion } from "@/config";
import { ApiRequestError } from "@/lib/api-client";
import { formatFinanceMoney } from "@/features/services/crew-finance-api";
import {
  fetchWithdrawalProof,
  fetchWithdrawalRecipient,
  requestWithdrawal,
  withdrawalCommand,
  withdrawalPreview,
  withdrawalRecipient,
  type WithdrawalBalance,
  type WithdrawalCommand,
  type WithdrawalRecipient,
} from "./withdrawal-api";
import { withdrawalPending } from "./withdrawal-pending";
import { withdrawalStorage } from "./withdrawal-storage";
import { useWithdrawals } from "./use-withdrawals";

const emptyRecipient: WithdrawalRecipient = {
  fullName: "",
  accountNumber: "",
  address: "",
  swift: "",
  branchAddress: "",
};
const buttonStyle = { minHeight: 44, justifyContent: "center" as const };
type WithdrawalProps = { userId: string; generation: number; onSubmitted?: () => void };
export function CreatorWithdrawals({ userId, generation, onSubmitted }: WithdrawalProps) {
  const [storageAttempt, setStorageAttempt] = useState(0);
  return (
    <WithdrawalSession
      key={JSON.stringify([userId, generation, storageAttempt])}
      userId={userId}
      generation={generation}
      onSubmitted={onSubmitted}
      onStorageRetry={() => setStorageAttempt((value) => value + 1)}
    />
  );
}
function WithdrawalSession({
  userId,
  generation,
  onSubmitted,
  onStorageRetry,
}: WithdrawalProps & { onStorageRetry(): void }) {
  const active = useScreenActive() && generation === getAuthGeneration();
  const theme = useTheme(),
    t = useTranslations(),
    locale = useLocale();
  const feed = useWithdrawals(generation, active);
  const [store] = useState(() => withdrawalPending(generation, withdrawalStorage(userId)));
  const [initial] = useState(() => {
    try {
      return { pending: store.read(), error: "" };
    } catch (cause) {
      return { pending: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  });
  const [currency, setCurrency] = useState<"USD" | "CNY">(
    initial.pending?.currency ?? (isChinaRegion ? "CNY" : "USD")
  );
  const [form, setForm] = useState<{
    balance: WithdrawalBalance;
    pending: WithdrawalCommand | null;
  } | null>(() =>
    initial.pending
      ? {
          pending: initial.pending,
          balance: {
            currency: initial.pending.currency,
            availableAmountMinor: initial.pending.expectedAvailableAmountMinor,
            confirmedAmountMinor: "0",
            reservedAmountMinor: "0",
            paidAmountMinor: "0",
          },
        }
      : null
  );
  const [submitted, setSubmitted] = useState(false);
  const balance = feed.balances?.find((row) => row.currency === currency);
  return (
    <View style={{ gap: 12, display: active ? "flex" : "none" }}>
      <ThemedText type="smallBold">{t("creatorWithdrawals.title")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t("creatorWithdrawals.description")}
      </ThemedText>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {(["USD", "CNY"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityLabel={`${t("creatorWithdrawals.currency")} ${value}`}
            accessibilityState={{ selected: currency === value, disabled: !!form }}
            disabled={!!form}
            style={buttonStyle}
            onPress={() => setCurrency(value)}
          >
            <ThemedText style={{ color: currency === value ? theme.brand : theme.text }}>
              {value}
            </ThemedText>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          disabled={feed.loading}
          onPress={feed.refresh}
          style={buttonStyle}
        >
          <ThemedText>{t("creatorWithdrawals.refresh")}</ThemedText>
        </Pressable>
      </View>
      {feed.loading && <ActivityIndicator />}
      {feed.balanceError && <ThemedText accessibilityRole="alert">{feed.balanceError}</ThemedText>}
      {!feed.loading &&
        !feed.balanceError &&
        feed.balances &&
        (
          [
            ["available", "availableAmountMinor"],
            ["reserved", "reservedAmountMinor"],
            ["paid", "paidAmountMinor"],
          ] as const
        ).map(([label, field]) => (
          <View key={field} style={{ gap: 4 }}>
            <ThemedText type="small">{t(`creatorWithdrawals.${label}`)}</ThemedText>
            <ThemedText type="smallBold">
              {formatFinanceMoney(balance?.[field] ?? "0", currency)}
            </ThemedText>
          </View>
        ))}
      {!!initial.error && (
        <View>
          <ThemedText accessibilityRole="alert">{initial.error}</ThemedText>
          <Pressable accessibilityRole="button" style={buttonStyle} onPress={onStorageRetry}>
            <ThemedText>{t("creatorWithdrawals.retry")}</ThemedText>
          </Pressable>
        </View>
      )}
      {submitted && (
        <ThemedText accessibilityRole="alert">{t("creatorWithdrawals.submitted")}</ThemedText>
      )}
      {!form && (
        <Pressable
          accessibilityRole="button"
          style={buttonStyle}
          disabled={
            !!initial.error ||
            feed.loading ||
            !!feed.balanceError ||
            !balance ||
            !withdrawalPreview(balance.availableAmountMinor, "100")
          }
          onPress={() => {
            if (balance) {
              setSubmitted(false);
              setForm({ balance, pending: null });
            }
          }}
        >
          <ThemedText>{t("creatorWithdrawals.withdraw")}</ThemedText>
        </Pressable>
      )}
      {form && (
        <WithdrawalForm
          balance={form.balance}
          initialPending={form.pending}
          generation={generation}
          active={active}
          store={store}
          onClose={() => {
            setForm(null);
            feed.refresh();
          }}
          onSubmitted={() => {
            setForm(null);
            setSubmitted(true);
            feed.refresh();
            onSubmitted?.();
          }}
        />
      )}
      <ThemedText type="smallBold">{t("creatorWithdrawals.history")}</ThemedText>
      {feed.items.map((row) => (
        <View
          key={row.id}
          style={{ gap: 6, padding: 12, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        >
          <ThemedText type="smallBold">
            {formatFinanceMoney(row.amountMinor, row.currency)}
          </ThemedText>
          <ThemedText type="small">
            {t(`creatorWithdrawals.states.${row.status}`)} ·{" "}
            {new Date(row.createdAt).toLocaleDateString(locale)}
          </ThemedText>
          {row.paidAt && (
            <ThemedText type="small">
              {t("creatorWithdrawals.paid")}: {new Date(row.paidAt).toLocaleDateString(locale)}
            </ThemedText>
          )}
          {!!row.resolutionReason && <ThemedText type="small">{row.resolutionReason}</ThemedText>}
          {row.status === "paid" && row.hasPaymentProof && (
            <PaymentProof withdrawalId={row.id} generation={generation} active={active} />
          )}
        </View>
      ))}
      {!feed.loading && !feed.historyError && !feed.items.length && (
        <ThemedText type="small">{t("creatorWithdrawals.empty")}</ThemedText>
      )}
      {!!feed.historyError && (
        <ThemedText accessibilityRole="alert">{feed.historyError}</ThemedText>
      )}
      {(feed.hasMore || feed.historyError) && (
        <Pressable
          accessibilityRole="button"
          disabled={feed.loading}
          style={buttonStyle}
          onPress={feed.loadMore}
        >
          <ThemedText>
            {t(feed.historyError ? "creatorWithdrawals.retry" : "creatorWithdrawals.loadMore")}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}
function WithdrawalForm({
  balance,
  initialPending,
  generation,
  active,
  store,
  onClose,
  onSubmitted,
}: {
  balance: WithdrawalBalance;
  initialPending: WithdrawalCommand | null;
  generation: number;
  active: boolean;
  store: ReturnType<typeof withdrawalPending>;
  onClose(): void;
  onSubmitted(): void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [pending, setPending] = useState(initialPending);
  const [recipient, setRecipient] = useState<WithdrawalRecipient>(
    initialPending?.recipient ?? emptyRecipient
  );
  const [percentage, setPercentage] = useState(
    initialPending ? String(initialPending.percentageBps / 100) : "100"
  );
  const [loaded, setLoaded] = useState(!!initialPending),
    [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0),
    [sending, setSending] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false);
  const controller = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    controller.current = c;
    if (!loaded)
      void fetchWithdrawalRecipient(generation, c.signal)
        .then((value) => {
          if (!c.signal.aborted) {
            setRecipient(value ?? emptyRecipient);
            setLoaded(true);
            setLoadError("");
          }
        })
        .catch((cause: unknown) => {
          if (!c.signal.aborted)
            setLoadError(cause instanceof Error ? cause.message : String(cause));
        });
    return () => {
      c.abort();
      controller.current = null;
    };
  }, [generation, active, attempt, loaded]);
  const preview = withdrawalPreview(balance.availableAmountMinor, percentage);
  const valid = withdrawalCommand.safeParse({
    requestId: "00000000-0000-4000-8000-000000000000",
    currency: balance.currency,
    percentageBps: preview?.percentageBps,
    expectedAvailableAmountMinor: balance.availableAmountMinor,
    recipient,
  });
  async function submit() {
    const c = controller.current;
    if (
      !active ||
      !c ||
      c.signal.aborted ||
      inFlight.current ||
      !loaded ||
      stale ||
      !valid.success ||
      !preview
    )
      return;
    inFlight.current = true;
    setSending(true);
    setError("");
    const request = pending ?? { ...valid.data, requestId: uuid.v4() };
    try {
      store.save(request);
      setPending(request);
      await requestWithdrawal(request, generation, c.signal);
      store.clear(request.requestId);
      if (!c.signal.aborted && getAuthGeneration() === generation) onSubmitted();
    } catch (cause) {
      if (!c.signal.aborted && getAuthGeneration() === generation) {
        setError(cause instanceof Error ? cause.message : String(cause));
        if (cause instanceof ApiRequestError && cause.status >= 400 && cause.status < 500) {
          // Validation failures are definitive; network/5xx/invalid receipts retain frozen terms.
          try {
            store.clear(request.requestId);
            setPending(null);
            if (cause.status === 409) setStale(true);
          } catch (storageError) {
            setError(storageError instanceof Error ? storageError.message : String(storageError));
          }
        }
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  const locked = sending || !!pending || stale;
  return (
    <View style={{ gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: theme.border }}>
      <ThemedText type="smallBold">{t("creatorWithdrawals.formTitle")}</ThemedText>
      {!loaded && !loadError && <ActivityIndicator />}
      {!!loadError && (
        <>
          <ThemedText accessibilityRole="alert">{loadError}</ThemedText>
          <Pressable
            accessibilityRole="button"
            style={buttonStyle}
            onPress={() => {
              setLoadError("");
              setAttempt((v) => v + 1);
            }}
          >
            <ThemedText>{t("creatorWithdrawals.retry")}</ThemedText>
          </Pressable>
        </>
      )}
      {loaded && (
        <>
          <ThemedText type="small">{t("creatorWithdrawals.percentage")}</ThemedText>
          <TextInput
            accessibilityLabel={t("creatorWithdrawals.percentage")}
            value={percentage}
            onChangeText={setPercentage}
            editable={!locked}
            keyboardType="decimal-pad"
            maxLength={6}
            style={{ color: theme.text, padding: 12, backgroundColor: theme.backgroundElement }}
          />
          <ThemedText>
            {t("creatorWithdrawals.amount")}:{" "}
            {preview
              ? formatFinanceMoney(preview.amountMinor, balance.currency)
              : t("creatorWithdrawals.invalidPercentage")}
          </ThemedText>
          {(Object.keys(emptyRecipient) as (keyof WithdrawalRecipient)[]).map((field) => (
            <View key={field} style={{ gap: 4 }}>
              <ThemedText type="small">{t(`creatorWithdrawals.bank.${field}`)} *</ThemedText>
              <TextInput
                accessibilityLabel={t(`creatorWithdrawals.bank.${field}`)}
                value={recipient[field]}
                editable={!locked}
                onChangeText={(value) =>
                  setRecipient((previous) => ({
                    ...previous,
                    [field]: field === "swift" ? value.toUpperCase() : value,
                  }))
                }
                autoCorrect={false}
                autoComplete="off"
                autoCapitalize={field === "swift" ? "characters" : "none"}
                maxLength={
                  field === "fullName"
                    ? 200
                    : field === "accountNumber"
                      ? 120
                      : field === "swift"
                        ? 11
                        : 1000
                }
                style={{ color: theme.text, padding: 12, backgroundColor: theme.backgroundElement }}
              />
            </View>
          ))}
          {!withdrawalRecipient.safeParse(recipient).success && (
            <ThemedText type="small" accessibilityRole="alert">
              {t("creatorWithdrawals.invalidBankDetails")}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {t("creatorWithdrawals.bankHint")}
          </ThemedText>
          {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
          {!!pending && <ThemedText type="small">{t("creatorWithdrawals.retryHint")}</ThemedText>}
          {stale ? (
            <Pressable accessibilityRole="button" style={buttonStyle} onPress={onClose}>
              <ThemedText>{t("creatorWithdrawals.reviewBalance")}</ThemedText>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              style={buttonStyle}
              disabled={sending || !valid.success || !preview}
              onPress={() => void submit()}
            >
              <ThemedText>
                {t(
                  sending
                    ? "creatorWithdrawals.submitting"
                    : pending
                      ? "creatorWithdrawals.retry"
                      : "creatorWithdrawals.submit"
                )}
              </ThemedText>
            </Pressable>
          )}
        </>
      )}
      {!pending && (
        <Pressable
          accessibilityRole="button"
          style={buttonStyle}
          disabled={sending}
          onPress={onClose}
        >
          <ThemedText>{t("creatorWithdrawals.cancel")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
function PaymentProof({
  withdrawalId,
  generation,
  active,
}: {
  withdrawalId: string;
  generation: number;
  active: boolean;
}) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    controller.current = c;
    return () => {
      c.abort();
      controller.current = null;
    };
  }, [active]);
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={buttonStyle}
        onPress={async () => {
          const c = controller.current;
          if (!c || c.signal.aborted || inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          setError("");
          try {
            const url = await fetchWithdrawalProof(withdrawalId, generation, c.signal);
            if (!c.signal.aborted && generation === getAuthGeneration()) await Linking.openURL(url);
          } catch (cause) {
            if (!c.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            inFlight.current = false;
            setBusy(false);
          }
        }}
      >
        <ThemedText>
          {t(busy ? "creatorWithdrawals.proofLoading" : "creatorWithdrawals.viewPaymentProof")}
        </ThemedText>
      </Pressable>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}
