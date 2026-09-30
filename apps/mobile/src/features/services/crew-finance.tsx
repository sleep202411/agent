import { AmendmentFinance } from "./amendment-finance";
import { CrewSpendSummary } from "./crew-spend";
import { CrewExpenses } from "./crew-expenses";
import { CrewCompute } from "./crew-compute";
import { PayoutCreate } from "./payout-create";
import { EarningCreate } from "./earning-create";
import { CrewFinanceDetail } from "./crew-finance-detail";
import { CrewFinanceTrend } from "./crew-finance-trend";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { isChinaRegion } from "@/config/app-env";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import {
  fetchFinanceAccess,
  fetchFinancePage,
  formatFinanceMoney,
  earningStatuses,
  payoutStatuses,
  type FinanceView,
  type FinanceScope,
  type FinancePage,
} from "./crew-finance-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function CrewFinance(props: Props) {
  const active = useScreenActive();
  if (!active || props.generation !== getAuthGeneration()) return null;
  return <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />;
}
function Session(props: Props) {
  const t = useTranslations();
  const [spend, setSpend] = useState(false);
  const [expenses, setExpenses] = useState(false);
  const [compute, setCompute] = useState(false);
  const [revision, setRevision] = useState(0),
    [access, setAccess] = useState<{ revision: number; allowed?: boolean; error?: string }>();
  const [view, setView] = useState<FinanceView>("earnings"),
    [scope, setScope] = useState<FinanceScope>("mine"),
    [status, setStatus] = useState("all");
  useEffect(() => {
    const controller = new AbortController();
    void fetchFinanceAccess(props.crewId, props.userId, controller.signal).then(
      (allowed) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setAccess({ revision, allowed });
      },
      (cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setAccess({ revision, error: cause instanceof Error ? cause.message : String(cause) });
      }
    );
    return () => controller.abort();
  }, [props.crewId, props.userId, props.generation, revision]);
  const visible = access?.revision === revision ? access : undefined;
  const effectiveScope = visible?.allowed ? scope : "mine";
  if (spend && visible?.allowed)
    return (
      <CrewSpendSummary
        {...props}
        onClose={() => {
          setSpend(false);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (expenses)
    return (
      <CrewExpenses
        {...props}
        onClose={() => {
          setExpenses(false);
          setRevision((n) => n + 1);
        }}
      />
    );
  if (compute)
    return (
      <CrewCompute
        {...props}
        onClose={() => {
          setCompute(false);
          setRevision((n) => n + 1);
        }}
      />
    );
  return (
    <View style={{ flex: 1 }}>
      <ThemedText>{t("crewFinance.title")}</ThemedText>
      <AmendmentFinance
        key={`amendment:${revision}`}
        {...props}
        onClose={() => setRevision((n) => n + 1)}
      />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => setExpenses(true)}
      >
        <ThemedText>{t("crewExpenses.title")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => setCompute(true)}
      >
        <ThemedText>{t("crewComputeFinance.title")}</ThemedText>
      </Pressable>
      {view === "earnings" ? (
        <EarningCreate
          key={`earning-create:${revision}`}
          {...props}
          onSaved={() => setRevision((n) => n + 1)}
        />
      ) : (
        <PayoutCreate
          key={`payout-create:${revision}`}
          {...props}
          onSaved={() => setRevision((n) => n + 1)}
        />
      )}
      {visible?.allowed && (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => setSpend(true)}
        >
          <ThemedText>{t("crewSpend.heading")}</ThemedText>
        </Pressable>
      )}
      {!visible && <ActivityIndicator />}
      {visible?.error && <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>}
      {visible?.allowed !== undefined && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {(["earnings", "payouts"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: view === value }}
                style={{ padding: 12 }}
                onPress={() => {
                  setView(value);
                  setStatus("all");
                }}
              >
                <ThemedText>{t(`crewFinance.${value}`)}</ThemedText>
              </Pressable>
            ))}
          </View>
          {visible.allowed && (
            <View style={{ flexDirection: "row" }}>
              {(["mine", "crew"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: effectiveScope === value }}
                  style={{ padding: 12 }}
                  onPress={() => setScope(value)}
                >
                  <ThemedText>{t(`crewFinance.${value}`)}</ThemedText>
                </Pressable>
              ))}
            </View>
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {(["all", ...(view === "earnings" ? earningStatuses : payoutStatuses)] as const).map(
              (value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: status === value }}
                  style={{ padding: 10 }}
                  onPress={() => setStatus(value)}
                >
                  <ThemedText>{t(`crewFinance.${value}`)}</ThemedText>
                </Pressable>
              )
            )}
          </View>
          <Ledger
            key={`${revision}:${view}:${effectiveScope}:${status}`}
            {...props}
            view={view}
            scope={effectiveScope}
            status={status}
            refresh={() => setRevision((n) => n + 1)}
          />
        </>
      )}
      <View style={{ flexDirection: "row" }}>
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => setRevision((n) => n + 1)}
        >
          <ThemedText>{t("thread.refresh")}</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={props.onClose}>
          <ThemedText>{t("crewTasks.back")}</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}
function Ledger(
  props: Props & { view: FinanceView; scope: FinanceScope; status: string; refresh: () => void }
) {
  const t = useTranslations(),
    currency = isChinaRegion ? "CNY" : "USD";
  const [cursor, setCursor] = useState<string | null>(null),
    [page, setPage] = useState<FinancePage>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState<FinancePage["items"][number]>();
  const collected = useRef<FinancePage["items"]>([]),
    seen = useRef(new Set<string>()),
    requesting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    requesting.current = true;
    void fetchFinancePage(
      props.crewId,
      props.userId,
      { view: props.view, scope: props.scope, status: props.status, currency, cursor },
      controller.signal
    )
      .then((next) => {
        if (controller.signal.aborted || props.generation !== getAuthGeneration()) return;
        if (
          next.items.some((row) => collected.current.some((old) => old.id === row.id)) ||
          (next.nextCursor !== null && seen.current.has(next.nextCursor))
        )
          throw new Error("Crew finance pagination changed. Refresh to reload.");
        if (cursor) seen.current.add(cursor);
        collected.current = [...collected.current, ...next.items];
        setPage({ ...next, items: collected.current });
      })
      .catch((cause) => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted && props.generation === getAuthGeneration()) {
          requesting.current = false;
          setBusy(false);
        }
      });
    return () => controller.abort();
  }, [
    props.crewId,
    props.userId,
    props.generation,
    props.view,
    props.scope,
    props.status,
    currency,
    cursor,
  ]);
  if (selected)
    return (
      <CrewFinanceDetail
        crewId={props.crewId}
        userId={props.userId}
        onChanged={props.refresh}
        view={props.view}
        selected={selected}
        generation={props.generation}
        onClose={() => setSelected(undefined)}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewFinance.recordHelp")}</ThemedText>
      {page?.summary.map((item) => (
        <ThemedText key={item.label}>
          {t(`crewFinance.${item.label}`)} · {formatFinanceMoney(item.amount, currency)}
        </ThemedText>
      ))}
      {props.view === "earnings" && page && (
        <>
          {page.profitShare !== undefined && (
            <ThemedText>
              {t("crewFinance.profitShare")} · {formatFinanceMoney(page.profitShare, currency)}
            </ThemedText>
          )}
          <CrewFinanceTrend value={page.postedDaily} currency={currency} failed={!!error} />
        </>
      )}
      {page?.items.length === 0 && <ThemedText>{t("crewFinance.empty")}</ThemedText>}
      {page?.items.map((row) => (
        <View key={row.id} style={{ paddingVertical: 12, gap: 6 }}>
          <Pressable
            accessibilityRole="button"
            style={{ paddingVertical: 12 }}
            onPress={() => {
              if (props.generation === getAuthGeneration()) setSelected(row);
            }}
          >
            <ThemedText>
              {row.title || t("crewFinance.payouts")} · {t("crewFinance.details")}
            </ThemedText>
          </Pressable>
          <ThemedText>
            {formatFinanceMoney(row.amountMinor, row.currency)} · {t(`crewFinance.${row.status}`)}
          </ThemedText>
          <ThemedText>{new Date(row.createdAt).toLocaleString()}</ThemedText>
          {props.scope === "crew" && (
            <ThemedText>
              {t("crewFinance.recipient")} · {row.userId}
            </ThemedText>
          )}
          {row.sourceType && <ThemedText>{t(`crewFinance.source_${row.sourceType}`)}</ThemedText>}
          {!!row.description && <ThemedText>{row.description}</ThemedText>}
          {row.netAmountMinor !== undefined && (
            <ThemedText>
              {t("crewFinance.net")} · {formatFinanceMoney(row.netAmountMinor, row.currency)}
            </ThemedText>
          )}
          {row.withholdingAmountMinor !== undefined && (
            <ThemedText>
              {t("crewFinance.withheld")} ·{" "}
              {formatFinanceMoney(row.withholdingAmountMinor, row.currency)}
            </ThemedText>
          )}
        </View>
      ))}
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {page?.nextCursor && (
        <Pressable
          accessibilityRole="button"
          disabled={busy || !!error}
          style={{ padding: 12 }}
          onPress={() => {
            if (requesting.current || props.generation !== getAuthGeneration()) return;
            requesting.current = true;
            setBusy(true);
            setCursor(page.nextCursor);
          }}
        >
          <ThemedText>{t("crewFinance.more")}</ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}
