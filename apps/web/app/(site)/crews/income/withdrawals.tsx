"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { CREW_CURRENCY, formatCrewMoney, type CrewLedgerCurrency } from "@/src/lib/crew-money";
import { crewApi, CrewApiError } from "../_hooks/api";

interface Balance {
  currency: CrewLedgerCurrency;
  confirmedAmountMinor: string;
  availableAmountMinor: string;
  reservedAmountMinor: string;
  paidAmountMinor: string;
}
interface Withdrawal {
  id: string;
  currency: CrewLedgerCurrency;
  amountMinor: string;
  percentageBps: number;
  status: "pending" | "processing" | "paid" | "rejected" | "cancelled";
  createdAt: string;
  paidAt: string | null;
  hasPaymentProof?: boolean;
  resolutionReason: string | null;
}
interface Recipient {
  fullName: string;
  accountNumber: string;
  address: string;
  swift: string;
  branchAddress: string;
}
const emptyRecipient: Recipient = {
  fullName: "",
  accountNumber: "",
  address: "",
  swift: "",
  branchAddress: "",
};

export function withdrawalPreview(available: string, percentage: string) {
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(percentage) || !/^\d+$/.test(available)) return null;
  const [whole, fraction = ""] = percentage.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (bps < 1 || bps > 10000) return null;
  const amount = (BigInt(available) * BigInt(bps)) / 10000n;
  if (amount <= 0n || BigInt(available) > 9223372036854775807n) return null;
  return { percentageBps: bps, amountMinor: amount.toString() };
}

export function CreatorWithdrawals() {
  const { user } = useCurrentUser();
  return user ? <WithdrawalSession key={user.id} userId={user.id} /> : null;
}

function WithdrawalSession({ userId }: { userId: string }) {
  const t = useTranslations("creatorWithdrawals");
  const locale = useLocale();
  const client = useQueryClient();
  const [currency, setCurrency] = useState<CrewLedgerCurrency>(CREW_CURRENCY);
  const [snapshot, setSnapshot] = useState<Balance | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const balances = useQuery({
    queryKey: ["creator-withdrawal-balances", userId],
    queryFn: ({ signal }) =>
      crewApi.get<Balance[]>("/me/withdrawals/balances", { signal, cache: "no-store" }),
    refetchInterval: 60000,
    gcTime: 0,
  });
  const history = useInfiniteQuery({
    queryKey: ["creator-withdrawal-history", userId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      crewApi.get<{ items: Withdrawal[]; nextCursor: string | null }>("/me/withdrawals", {
        signal,
        cache: "no-store",
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 60000,
    gcTime: 0,
  });
  const balance = balances.data?.find((row) => row.currency === currency);
  const rows = history.data?.pages.flatMap((page) => page.items) ?? [];
  const canWithdraw =
    !balances.isError &&
    !balances.isPending &&
    balance &&
    withdrawalPreview(balance.availableAmountMinor, "100");
  function refresh() {
    void balances.refetch();
    void history.refetch();
  }
  function onSubmitted() {
    setSnapshot(null);
    setSubmitted(true);
    refresh();
    for (const key of ["crew-personal-earnings", "crew-personal-payouts"])
      void client.invalidateQueries({ queryKey: [key, userId] });
  }
  return (
    <section className="space-y-4 rounded-xl bg-white/[0.035] p-5" aria-label={t("title")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button
          disabled={!canWithdraw || Boolean(snapshot)}
          onClick={() => {
            setSubmitted(false);
            setSnapshot(balance!);
          }}
        >
          {t("withdraw")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t("currency")}
          <NativeSelect
            className="rounded-md bg-secondary p-2"
            value={currency}
            disabled={Boolean(snapshot)}
            onChange={(value) => setCurrency(value as CrewLedgerCurrency)}
          >
            <NativeSelectOption value="USD">USD</NativeSelectOption>
            <NativeSelectOption value="CNY">CNY</NativeSelectOption>
          </NativeSelect>
        </label>
        <Button
          variant="outline"
          disabled={balances.isFetching || history.isFetching}
          onClick={refresh}
        >
          {t("refresh")}
        </Button>
      </div>
      {balances.isPending && <p role="status">{t("loading")}</p>}
      {balances.isError && (
        <p role="alert" className="text-destructive">
          {balances.error.message}
        </p>
      )}
      {!balances.isPending && !balances.isError && (
        <dl className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ["available", "availableAmountMinor"],
              ["reserved", "reservedAmountMinor"],
              ["paid", "paidAmountMinor"],
            ] as const
          ).map(([label, key]) => (
            <div key={key}>
              <dt className="text-sm text-muted-foreground">{t(label)}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {formatCrewMoney(balance?.[key] ?? "0", locale, currency)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {submitted && <p role="status">{t("submitted")}</p>}
      {snapshot && (
        <WithdrawalForm
          balance={snapshot}
          onClose={() => {
            setSnapshot(null);
            refresh();
          }}
          onSubmitted={onSubmitted}
        />
      )}
      <h3 className="font-semibold">{t("history")}</h3>
      {history.isPending && <p role="status">{t("loading")}</p>}
      {history.isError && (
        <p role="alert" className="text-destructive">
          {history.error.message}
        </p>
      )}
      {!history.isPending && !history.isError && !rows.length && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {["date", "amount", "status", "details"].map((key) => (
                  <th key={key} className="px-2 py-3 font-medium text-muted-foreground">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-white/10">
                  <td className="whitespace-nowrap px-2 py-3">
                    {new Date(row.createdAt).toLocaleDateString(locale)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-3 tabular-nums">
                    {formatCrewMoney(row.amountMinor, locale, row.currency)}
                  </td>
                  <td className="px-2 py-3">{t(`states.${row.status}`)}</td>
                  <td className="px-2 py-3">
                    {row.paidAt
                      ? new Date(row.paidAt).toLocaleDateString(locale)
                      : row.resolutionReason || "—"}
                    {row.status === "paid" && row.hasPaymentProof && (
                      <PaymentProofDownload withdrawalId={row.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetching}
          onClick={() => void history.fetchNextPage()}
        >
          {t("loadMore")}
        </Button>
      )}
    </section>
  );
}

function WithdrawalForm({
  balance,
  onClose,
  onSubmitted,
}: {
  balance: Balance;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const t = useTranslations("creatorWithdrawals");
  const locale = useLocale();
  const [recipient, setRecipient] = useState<Recipient>({ ...emptyRecipient });
  const [percentage, setPercentage] = useState("100");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [stale, setStale] = useState(false);
  const loadFailed = t("loadFailed");
  const inFlight = useRef(false);
  const request = useRef<{
    requestId: string;
    currency: CrewLedgerCurrency;
    percentageBps: number;
    expectedAvailableAmountMinor: string;
    recipient: Recipient;
  } | null>(null);
  const preview = withdrawalPreview(balance.availableAmountMinor, percentage);
  useEffect(() => {
    const abort = new AbortController();
    crewApi
      .get<{ recipient: Recipient } | null>("/me/withdrawals/recipient", {
        signal: abort.signal,
        cache: "no-store",
      })
      .then((result) => {
        if (!abort.signal.aborted) {
          setRecipient(result?.recipient ?? { ...emptyRecipient });
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setLoadError(cause instanceof Error ? cause.message : loadFailed);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [attempt, loadFailed]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || loading || loadError || stale || !preview) return;
    inFlight.current = true;
    setSending(true);
    setError("");
    request.current ??= {
      requestId: crypto.randomUUID(),
      currency: balance.currency,
      percentageBps: preview.percentageBps,
      expectedAvailableAmountMinor: balance.availableAmountMinor,
      recipient: { ...recipient },
    };
    try {
      await crewApi.post("/me/withdrawals", { body: request.current });
      onSubmitted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("submitFailed"));
      // Keep the same terms/key after an ambiguous network/5xx failure.
      // A definitive validation rejection allows the creator to edit again.
      if (cause instanceof CrewApiError && cause.status >= 400 && cause.status < 500) {
        request.current = null;
        setRetrying(false);
        if (cause.status === 409) setStale(true);
      } else setRetrying(true);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4 border-t border-white/10 pt-5"
      aria-label={t("formTitle")}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{t("formTitle")}</h3>
        <Button type="button" variant="ghost" disabled={sending} onClick={onClose}>
          {t("cancel")}
        </Button>
      </div>
      {loading && <p role="status">{t("loading")}</p>}
      {loadError && (
        <div role="alert">
          <p>{loadError}</p>
          <Button
            type="button"
            onClick={() => {
              setLoading(true);
              setLoadError("");
              setAttempt((value) => value + 1);
            }}
          >
            {t("retry")}
          </Button>
        </div>
      )}
      {!loading && !loadError && (
        <>
          <fieldset disabled={sending || retrying} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>{t("percentage")}</span>
              <input
                className="w-full rounded-md border border-white/15 bg-background p-3"
                inputMode="decimal"
                value={percentage}
                onChange={(event) => setPercentage(event.target.value)}
                required
                pattern="[0-9]{1,3}([.][0-9]{1,2})?"
              />
            </label>
            <div className="space-y-1 text-sm">
              <p>{t("amount")}</p>
              <p className="py-3 text-lg font-semibold tabular-nums" aria-live="polite">
                {preview
                  ? formatCrewMoney(preview.amountMinor, locale, balance.currency)
                  : t("invalidPercentage")}
              </p>
            </div>
            {(Object.keys(emptyRecipient) as (keyof Recipient)[]).map((key) => (
              <label key={key} className="space-y-1 text-sm">
                <span>{t(`bank.${key}`)}</span>
                <input
                  className="w-full rounded-md border border-white/15 bg-background p-3"
                  name={key}
                  value={recipient[key]}
                  onChange={(event) =>
                    setRecipient((value) => ({
                      ...value,
                      [key]:
                        key === "swift" ? event.target.value.toUpperCase() : event.target.value,
                    }))
                  }
                  required
                  maxLength={
                    key === "fullName"
                      ? 200
                      : key === "accountNumber"
                        ? 120
                        : key === "swift"
                          ? 11
                          : 1000
                  }
                  pattern={key === "swift" ? "[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?" : undefined}
                  autoComplete="off"
                />
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">{t("bankHint")}</p>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {retrying && <p className="text-sm text-muted-foreground">{t("retryHint")}</p>}
          {stale && (
            <Button type="button" variant="outline" onClick={onClose}>
              {t("reviewBalance")}
            </Button>
          )}
          <Button type="submit" disabled={sending || stale || !preview}>
            {sending ? t("submitting") : retrying ? t("retry") : t("submit")}
          </Button>
        </>
      )}
    </form>
  );
}

function PaymentProofDownload({ withdrawalId }: { withdrawalId: string }) {
  const t = useTranslations("creatorWithdrawals");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <div className="mt-2 max-w-32 space-y-1">
      <Button
        size="sm"
        className="h-auto whitespace-normal py-1 text-left"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          if (busy.current) return;
          busy.current = true;
          setPending(true);
          setError(null);
          try {
            const result = await crewApi.post<{ url: string; expiresAt: string }>(
              `/me/withdrawals/${encodeURIComponent(withdrawalId)}/payment-proof/download`,
              {}
            );
            if (active.current) window.location.assign(result.url);
          } catch (cause) {
            if (active.current) setError(cause instanceof Error ? cause.message : t("proofFailed"));
          } finally {
            busy.current = false;
            if (active.current) setPending(false);
          }
        }}
      >
        {t(pending ? "proofLoading" : "viewPaymentProof")}
      </Button>
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
