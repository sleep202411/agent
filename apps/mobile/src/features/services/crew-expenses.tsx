import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import {
  fetchExpenses,
  fetchExpenseHistory,
  fetchExpenseReceipt,
  type ExpenseRecord,
} from "./crew-expenses-api";
import { formatFinanceMoney } from "./crew-finance-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function CrewExpenses(props: Props) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0),
    [draft, setDraft] = useState<string>();
  return (
    <View style={{ flex: 1 }}>
      <ThemedText>{t(draft ? "crewExpenses.history" : "crewExpenses.title")}</ThemedText>
      <Records
        key={`${revision}:${draft ?? "list"}`}
        {...props}
        draftId={draft}
        onSelect={setDraft}
      />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => setRevision((n) => n + 1)}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => {
          if (draft) setDraft(undefined);
          else props.onClose();
        }}
      >
        <ThemedText>{t(draft ? "mobileExpenses.backToClaims" : "crewExpenses.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Records(props: Props & { draftId?: string; onSelect: (id: string) => void }) {
  const t = useTranslations();
  const [items, setItems] = useState<ExpenseRecord[]>([]),
    [cursor, setCursor] = useState<string | number | null>(null),
    [next, setNext] = useState<string | number | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string>();
  const loaded = useRef<ExpenseRecord[]>([]),
    seen = useRef(new Set<string | number>()),
    pending = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    pending.current = true;
    const request = props.draftId
      ? fetchExpenseHistory(
          props.crewId,
          props.userId,
          props.draftId,
          cursor as number | null,
          c.signal
        )
      : fetchExpenses(props.crewId, props.userId, cursor as string | null, c.signal);
    void request
      .then((page) => {
        if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
        if (
          (page.nextCursor !== null && seen.current.has(page.nextCursor)) ||
          page.items.some((r) =>
            loaded.current.some((old) =>
              props.draftId ? old.version === r.version : old.id === r.id
            )
          )
        )
          throw new Error("Expense pagination changed. Refresh to reload.");
        if (cursor !== null) seen.current.add(cursor);
        loaded.current = [...loaded.current, ...page.items];
        setItems(loaded.current);
        setNext(page.nextCursor);
      })
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
          setBusy(false);
        }
      });
    return () => c.abort();
  }, [props.crewId, props.userId, props.draftId, props.generation, cursor]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewExpenses.note")}</ThemedText>
      {!busy && !error && !items.length && <ThemedText>{t("mobileExpenses.empty")}</ThemedText>}
      {items.map((row) => (
        <View key={`${row.id}:${row.version}`} style={{ gap: 8, paddingVertical: 12 }}>
          <ThemedText>
            {row.definition.category || t("crewExpenses.draft")} · {t("crewExpenses.revision")}{" "}
            {row.version} · {t(`crewExpenses.${row.submissionStatus ?? "draft"}`)}
          </ThemedText>
          <ThemedText>
            {t("crewExpenses.amount")} ·{" "}
            {row.definition.amountMinor === null
              ? "—"
              : formatFinanceMoney(row.definition.amountMinor, row.definition.currency)}
          </ThemedText>
          <ThemedText>
            {t("crewExpenses.purpose")} · {row.definition.purpose || "—"}
          </ThemedText>
          <ThemedText>
            {t("crewExpenses.date")} · {row.definition.occurredOn ?? "—"}
          </ThemedText>
          <ThemedText>
            {t("crewExpenses.savedAt")} · {new Date(row.createdAt).toLocaleString()}
          </ThemedText>
          <ThemedText>
            {t("crewExpenses.evidence")} · {row.definition.evidenceNote || "—"}
          </ThemedText>
          {(row.definition.receiptIds ?? []).map((id, index) => (
            <Receipt
              key={id}
              crewId={props.crewId}
              draftId={row.id}
              receiptId={id}
              generation={props.generation}
              index={index + 1}
            />
          ))}
          {!props.draftId && (
            <Pressable
              accessibilityRole="button"
              style={{ padding: 12 }}
              onPress={() => props.onSelect(row.id)}
            >
              <ThemedText>{t("crewExpenses.history")}</ThemedText>
            </Pressable>
          )}
        </View>
      ))}
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {next !== null && !error && (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          disabled={busy}
          onPress={() => {
            if (pending.current || props.generation !== getAuthGeneration()) return;
            pending.current = true;
            setBusy(true);
            setCursor(next);
          }}
        >
          <ThemedText>{t("crewExpenses.more")}</ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}
function Receipt(props: {
  crewId: string;
  draftId: string;
  receiptId: string;
  generation: number;
  index: number;
}) {
  const t = useTranslations(),
    active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(
    () => () => {
      active.current?.abort();
    },
    []
  );
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        disabled={busy}
        onPress={() => {
          if (active.current || props.generation !== getAuthGeneration()) return;
          const c = new AbortController();
          active.current = c;
          setBusy(true);
          setError(undefined);
          void fetchExpenseReceipt(props.crewId, props.draftId, props.receiptId, c.signal)
            .then(async (url) => {
              if (!c.signal.aborted && props.generation === getAuthGeneration())
                await Linking.openURL(url);
            })
            .catch((e) => {
              if (!c.signal.aborted && props.generation === getAuthGeneration())
                setError(e instanceof Error ? e.message : String(e));
            })
            .finally(() => {
              if (active.current === c) {
                active.current = null;
                if (!c.signal.aborted && props.generation === getAuthGeneration()) setBusy(false);
              }
            });
        }}
      >
        <ThemedText>
          {t("crewExpenses.openReceipt")} {props.index}
        </ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}
