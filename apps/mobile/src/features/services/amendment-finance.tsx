import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { formatFinanceMoney } from "./crew-finance-api";
import {
  fetchAmendmentAccess,
  fetchAmendments,
  settleAmendment,
  type Amendment,
  type AmendmentFilter,
} from "./amendment-finance-api";
type Props = { crewId: string; userId: string; generation: number };
type EntryProps = Props & { onClose: () => void };
export function AmendmentFinance(props: EntryProps) {
  return (
    <FinanceEntry key={JSON.stringify([props.crewId, props.userId, props.generation])} {...props} />
  );
}
function FinanceEntry(props: EntryProps) {
  const t = useTranslations(),
    theme = useTheme();
  const [allowed, setAllowed] = useState(false),
    [open, setOpen] = useState(false),
    [error, setError] = useState<string>();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const close = () => {
    if (pending.current) return;
    setOpen(false);
    props.onClose();
  };
  useEffect(() => {
    const c = new AbortController();
    void fetchAmendmentAccess(props.crewId, props.userId, c.signal).then(
      (value) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) setAllowed(value);
      },
      (e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration())
          setError(e instanceof Error ? e.message : String(e));
      }
    );
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation]);
  return (
    <View>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {allowed && (
        <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={() => setOpen(true)}>
          <ThemedText>{t("crewAmendmentFinance.title")}</ThemedText>
        </Pressable>
      )}
      {open && allowed && (
        <Modal visible onRequestClose={close}>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <Queue
              {...props}
              busy={busy}
              onPending={(value) => {
                pending.current = value;
                setBusy(value);
              }}
            />
            <Pressable
              accessibilityRole="button"
              style={{ padding: 12 }}
              disabled={busy}
              onPress={close}
            >
              <ThemedText>{t("crewExpenses.back")}</ThemedText>
            </Pressable>
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}
type OperationProps = { busy: boolean; onPending: (value: boolean) => void };
function Queue(props: Props & OperationProps) {
  const t = useTranslations();
  const [filter, setFilter] = useState<AmendmentFilter>("awaiting_settlement"),
    [revision, setRevision] = useState(0);
  return (
    <View style={{ flex: 1 }}>
      <ThemedText>{t("crewAmendmentFinance.title")}</ThemedText>
      <ThemedText>{t("crewAmendmentFinance.description")}</ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {(["awaiting_settlement", "settlement_requested"] as const).map((value) => (
          <Pressable
            key={value}
            disabled={props.busy}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === value }}
            style={{ padding: 12 }}
            onPress={() => setFilter(value)}
          >
            <ThemedText>{t(`crewAmendments.status.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      <Rows
        key={`${filter}:${revision}`}
        {...props}
        filter={filter}
        onRefresh={() => setRevision((n) => n + 1)}
      />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        disabled={props.busy}
        onPress={() => setRevision((n) => n + 1)}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Rows(props: Props & OperationProps & { filter: AmendmentFilter; onRefresh: () => void }) {
  const t = useTranslations();
  const [items, setItems] = useState<Amendment[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<Amendment>();
  const rows = useRef<Amendment[]>([]),
    seen = useRef(new Set<string>()),
    pending = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    pending.current = true;
    void (async () => {
      if (!(await fetchAmendmentAccess(props.crewId, props.userId, c.signal)))
        throw new Error("Finance earnings approval permission is required.");
      if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
      const page = await fetchAmendments(props.crewId, props.filter, cursor, c.signal);
      if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
      if (
        page.items.some((r) => rows.current.some((old) => old.id === r.id)) ||
        (page.nextCursor && seen.current.has(page.nextCursor))
      )
        throw new Error("Amendment pagination changed. Refresh to reload.");
      if (cursor) seen.current.add(cursor);
      rows.current = [...rows.current, ...page.items];
      setItems(rows.current);
      setNext(page.nextCursor);
    })()
      .catch((e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          setItems([]);
          setNext(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          pending.current = false;
          setLoading(false);
        }
      });
    return () => c.abort();
  }, [props.crewId, props.userId, props.generation, props.filter, cursor]);
  if (selected)
    return (
      <Settlement
        key={selected.id}
        record={selected}
        generation={props.generation}
        onPending={props.onPending}
        onClose={props.onRefresh}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      {items.map((row) => (
        <View key={row.id} style={{ gap: 8 }}>
          <Details row={row} />
          {row.status === "settlement_requested" ? (
            <ThemedText>{t("crewAmendmentFinance.manualResult")}</ThemedText>
          ) : (
            !row.settledAt && (
              <Pressable
                accessibilityRole="button"
                disabled={loading}
                style={{ padding: 12 }}
                onPress={() => setSelected(row)}
              >
                <ThemedText>{t("crewAmendmentFinance.review")}</ThemedText>
              </Pressable>
            )
          )}
        </View>
      ))}
      {loading && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!loading && !error && !items.length && (
        <ThemedText>{t("crewAmendmentFinance.empty")}</ThemedText>
      )}
      {next && !error && (
        <Pressable
          accessibilityRole="button"
          disabled={loading}
          style={{ padding: 12 }}
          onPress={() => {
            if (pending.current) return;
            pending.current = true;
            setLoading(true);
            setCursor(next);
          }}
        >
          <ThemedText>{t("crewAmendmentFinance.more")}</ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}
function Details({ row }: { row: Amendment }) {
  const t = useTranslations();
  return (
    <View style={{ gap: 6 }}>
      <ThemedText>
        {t("crewAmendmentFinance.identity")
          .replace("{amendment}", row.id)
          .replace("{application}", row.applicationId)
          .replace("{task}", row.taskId)}
      </ThemedText>
      <ThemedText>
        {t("crewAmendmentFinance.people")
          .replace("{creator}", row.applicantId)
          .replace("{proposer}", row.proposedByUserId)}
      </ThemedText>
      <ThemedText>
        {t("crewAmendmentFinance.target")} ·{" "}
        {formatFinanceMoney(row.proposal.feeAmount, row.proposal.currency)}
      </ThemedText>
      <ThemedText>{row.proposal.scope}</ThemedText>
      <ThemedText>
        {t("crewAmendments.share")} · {(row.proposal.revenueShareBp / 100).toFixed(2)}%
      </ThemedText>
      {row.proposal.paymentTerms && (
        <ThemedText>
          {t("taskPaymentTerms.label")}: {t(`taskPaymentTerms.${row.proposal.paymentTerms}`)}
        </ThemedText>
      )}
      {row.proposal.shareBasis && <ThemedText>{row.proposal.shareBasis}</ThemedText>}
      <ThemedText>{row.proposal.reason}</ThemedText>
      <ThemedText>
        {t("crewAmendmentFinance.consent").replace("{date}", row.confirmedAt ?? "")}
      </ThemedText>
    </View>
  );
}
function Settlement({
  record,
  generation,
  onClose,
  onPending,
}: {
  record: Amendment;
  generation: number;
  onClose: () => void;
  onPending: (value: boolean) => void;
}) {
  const t = useTranslations(),
    op = useAuthFormOperation(record.id, true);
  const [result, setResult] = useState<Amendment>(),
    [error, setError] = useState<string>(),
    [denied, setDenied] = useState(false),
    [attempted, setAttempted] = useState(false);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Details row={record} />
      <ThemedText>{t("crewAmendmentFinance.confirmation")}</ThemedText>
      <ThemedText>{t("crewAmendmentFinance.permissions")}</ThemedText>
      {result ? (
        <ThemedText>
          {t(
            result.status === "effective"
              ? "crewAmendmentFinance.effectiveResult"
              : "crewAmendmentFinance.manualResult"
          )}
        </ThemedText>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={op.busy || denied}
          style={{ padding: 12 }}
          onPress={() => {
            if (generation !== getAuthGeneration()) return;
            void op.run(
              () => {
                setAttempted(true);
                setError(undefined);
                onPending(true);
                return settleAmendment(record, generation).finally(() => onPending(false));
              },
              setResult,
              (cause) => {
                setError(cause instanceof Error ? cause.message : String(cause));
                const status =
                  cause && typeof cause === "object" && "status" in cause
                    ? cause.status
                    : undefined;
                if ([400, 401, 403, 404, 409, 422].includes(Number(status))) setDenied(true);
              }
            );
          }}
        >
          <ThemedText>
            {t(attempted ? "crewAmendmentFinance.retry" : "crewAmendmentFinance.apply")}
          </ThemedText>
        </Pressable>
      )}
      {op.busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={op.busy}
        style={{ padding: 12 }}
        onPress={onClose}
      >
        <ThemedText>{t("crewAmendmentFinance.cancel")}</ThemedText>
      </Pressable>
    </ScrollView>
  );
}
