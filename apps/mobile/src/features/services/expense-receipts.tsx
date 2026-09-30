import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import {
  fetchExpenseReceipts,
  pickExpenseReceipt,
  uploadExpenseReceipt,
  type ReceiptUpload,
} from "./expense-receipts-api";
type Props = {
  crewId: string;
  draftId: string;
  generation: number;
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
  onBusy: (busy: boolean) => void;
};
export function ExpenseReceipts(props: Props) {
  const t = useTranslations();
  const [hasUpload, setHasUpload] = useState(false);
  const [rows, setRows] = useState<{ id: string; name: string }[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const collected = useRef<{ id: string; name: string }[]>([]),
    seen = useRef(new Set<string>()),
    request = useRef<AbortController | null>(null),
    pending = useRef(false),
    upload = useRef<ReceiptUpload | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
    },
    []
  );
  useEffect(() => {
    const c = new AbortController();
    pending.current = true;
    void fetchExpenseReceipts(props.crewId, props.draftId, cursor, c.signal)
      .then((page) => {
        if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
        if (
          page.items.some((r) => collected.current.some((old) => old.id === r.id)) ||
          (page.nextCursor && seen.current.has(page.nextCursor))
        )
          throw new Error("Receipt pagination changed. Refresh to reload.");
        if (cursor) seen.current.add(cursor);
        collected.current = [...collected.current, ...page.items];
        setRows(collected.current);
        setNext(page.nextCursor);
      })
      .catch((e) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          setRows([]);
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
  }, [props.crewId, props.draftId, props.generation, cursor, revision]);
  const refresh = () => {
    collected.current = [];
    seen.current.clear();
    setRows([]);
    setNext(null);
    setCursor(null);
    setError(undefined);
    setLoading(true);
    setRevision((n) => n + 1);
  };
  const locked = props.disabled || busy;
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("crewExpenses.receiptHelp")}</ThemedText>
      {props.selected.map((id, index) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          disabled={locked}
          style={{ padding: 12 }}
          onPress={() => props.onChange(props.selected.filter((value) => value !== id))}
        >
          <ThemedText>
            {t("crewExpenses.removeReceipt")} ·{" "}
            {rows.find((r) => r.id === id)?.name ?? `${t("crewExpenses.receipt")} ${index + 1}`}
          </ThemedText>
        </Pressable>
      ))}
      {rows
        .filter((r) => !props.selected.includes(r.id))
        .map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            disabled={locked || props.selected.length >= 10}
            style={{ padding: 12 }}
            onPress={() => props.onChange([...props.selected, row.id])}
          >
            <ThemedText>
              {t("crewExpenses.attachReceipt")} · {row.name}
            </ThemedText>
          </Pressable>
        ))}
      <Pressable
        accessibilityRole="button"
        disabled={locked || props.selected.length >= 10}
        style={{ padding: 12 }}
        onPress={() => {
          if (request.current || props.generation !== getAuthGeneration()) return;
          const c = new AbortController();
          request.current = c;
          setBusy(true);
          props.onBusy(true);
          setError(undefined);
          void (async () => {
            try {
              if (!upload.current)
                upload.current = await pickExpenseReceipt(props.generation, c.signal);
              if (!upload.current) return;
              const receipt = await uploadExpenseReceipt(
                props.crewId,
                props.draftId,
                upload.current,
                props.generation,
                c.signal
              );
              if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
              props.onChange([...new Set([...props.selected, receipt.id])]);
              upload.current = null;
              refresh();
            } catch (e) {
              if (!c.signal.aborted && props.generation === getAuthGeneration())
                setError(e instanceof Error ? e.message : String(e));
            } finally {
              if (request.current === c) {
                request.current = null;
                if (!c.signal.aborted && props.generation === getAuthGeneration()) {
                  setHasUpload(Boolean(upload.current));
                  setBusy(false);
                  props.onBusy(false);
                }
              }
            }
          })();
        }}
      >
        <ThemedText>
          {t(hasUpload ? "receiptUpload.retry" : "crewExpenses.uploadReceipt")}
        </ThemedText>
      </Pressable>
      {hasUpload && !busy && (
        <Pressable
          accessibilityRole="button"
          disabled={props.disabled}
          style={{ padding: 12 }}
          onPress={() => {
            upload.current = null;
            setHasUpload(false);
            setError(undefined);
          }}
        >
          <ThemedText>{t("receiptUpload.chooseAnother")}</ThemedText>
        </Pressable>
      )}
      {next && !error && (
        <Pressable
          accessibilityRole="button"
          disabled={loading || locked}
          style={{ padding: 12 }}
          onPress={() => {
            if (pending.current) return;
            pending.current = true;
            setLoading(true);
            setCursor(next);
          }}
        >
          <ThemedText>{t("crewExpenses.more")}</ThemedText>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={loading || locked}
        style={{ padding: 12 }}
        onPress={refresh}
      >
        <ThemedText>{t("receiptUpload.refresh")}</ThemedText>
      </Pressable>
      {(loading || busy) && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}
