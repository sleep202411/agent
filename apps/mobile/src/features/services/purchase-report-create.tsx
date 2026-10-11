import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { ApiRequestError } from "@/lib/api-client";
import { uuid } from "expo-modules-core";
import { ThemedText } from "@/components/themed-text";
import { getAuthGeneration } from "@/auth/auth-store";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  fetchReportPurchases,
  purchaseReportOutbox,
  purchaseReportReasons,
  submitPurchaseReport,
  type ReportPurchase,
  type PurchaseReportCommand,
} from "./purchase-report-api";
type Props = {
  userId: string;
  generation: number;
  active: boolean;
  onClose: () => void;
  onSaved: () => void;
};
export function PurchaseReportCreate(props: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const [outbox] = useState(() => purchaseReportOutbox(props.userId, props.generation));
  const [initial] = useState(() => {
    try {
      return { pending: outbox.read(), error: "" };
    } catch (cause) {
      return { pending: null, error: String(cause) };
    }
  });
  const [pending, setPending] = useState(initial.pending),
    [selected, setSelected] = useState<ReportPurchase>();
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [reason, setReason] = useState<PurchaseReportCommand["reason"]>(
      initial.pending?.reason ?? "payment"
    ),
    [description, setDescription] = useState(initial.pending?.description ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(initial.error);
  const controller = useRef<AbortController | null>(null),
    flight = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    return () => {
      c.abort();
      controller.current = null;
    };
  }, []);
  const current = () =>
    !!controller.current &&
    !controller.current.signal.aborted &&
    props.generation === getAuthGeneration();
  const locked = busy || !!pending || !!initial.error;
  async function submit() {
    if (!props.active || !current() || flight.current || initial.error || (!pending && !selected))
      return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const command = pending ?? {
        clientKey: uuid.v4(),
        purchaseOrderId: selected!.id,
        orderNo: selected!.orderNo,
        targetType: selected!.targetType,
        targetId: selected!.episodeId ?? selected!.ipId,
        reason,
        description,
      };
      outbox.save(command);
      setPending(command);
      await submitPurchaseReport(command, props.generation, controller.current!.signal);
      outbox.clear(command.clientKey);
      if (current()) props.onSaved();
    } catch (cause) {
      if (current()) {
        if (cause instanceof ApiRequestError && [400, 401, 403, 404, 422].includes(cause.status)) {
          try {
            const previous = outbox.read();
            if (previous) outbox.clear(previous.clientKey);
            setPending(null);
            setSelected(undefined);
          } catch (storageError) {
            setError(storageError instanceof Error ? storageError.message : String(storageError));
            return;
          }
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      flight.current = false;
      if (current()) setBusy(false);
    }
  }
  return (
    <ScrollView
      style={{ display: props.active ? "flex" : "none" }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <ThemedText type="smallBold">{t("contentReports.newPurchaseReport")}</ThemedText>
      <ThemedText>{t("contentReports.purchaseHint")}</ThemedText>
      <ThemedText>{t("contentReports.purchaseSearch")}</ThemedText>
      <TextInput
        accessibilityLabel={t("contentReports.purchaseSearch")}
        value={search}
        editable={!locked}
        maxLength={180}
        onChangeText={setSearch}
        style={{ color: theme.text, padding: 12, borderColor: theme.border, borderWidth: 1 }}
      />
      <Button
        text={t("crewCases.searchRecords")}
        disabled={locked}
        onPress={() => {
          setSelected(undefined);
          setQuery(search.trim());
        }}
      />
      {props.active && !pending && !initial.error && (
        <Purchases
          key={query}
          query={query}
          generation={props.generation}
          select={setSelected}
          disabled={locked}
        />
      )}
      {(selected || pending) && (
        <>
          <ThemedText>{pending?.orderNo ?? selected?.orderNo}</ThemedText>
          <ThemedText>
            {t("contentReports.purchaseReference").replace(
              "{id}",
              pending?.purchaseOrderId ?? selected!.id
            )}
          </ThemedText>
          {selected && (
            <>
              <ThemedText>
                {t("contentReports.purchaseAmount")
                  .replace("{amount}", selected.totalAmount)
                  .replace(
                    "{currency}",
                    selected.currency === "community_point"
                      ? t("contentReports.communityPoints")
                      : selected.currency
                  )}
              </ThemedText>
              <ThemedText>
                {t("contentReports.purchaseStatus").replace(
                  "{status}",
                  t(`contentReports.purchaseStatuses.${selected.status}`)
                )}
              </ThemedText>
            </>
          )}
          <View style={{ gap: 8 }}>
            {purchaseReportReasons.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: reason === value }}
                disabled={locked}
                onPress={() => setReason(value)}
                style={{ padding: 12 }}
              >
                <ThemedText>
                  {reason === value ? "● " : "○ "}
                  {t(`purchaseReportReasons.${value}`)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <TextInput
            accessibilityLabel={t("contentReports.evidenceHint")}
            placeholder={t("contentReports.evidenceHint")}
            placeholderTextColor={theme.textSecondary}
            value={description}
            onChangeText={setDescription}
            editable={!locked}
            multiline
            maxLength={2000}
            style={{
              color: theme.text,
              padding: 12,
              minHeight: 96,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          />
          {pending && <ThemedText>{t("feedbackHistory.retryHelp")}</ThemedText>}
          <Button
            text={t(pending ? "feedbackHistory.retry" : "feedbackHistory.submit")}
            disabled={busy || !!initial.error}
            onPress={() => void submit()}
          />
        </>
      )}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Button text={t("common.cancel")} disabled={busy} onPress={props.onClose} />
    </ScrollView>
  );
}
function Button({
  text,
  disabled = false,
  onPress,
}: {
  text: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{text}</ThemedText>
    </Pressable>
  );
}
function Purchases({
  query,
  generation,
  select,
  disabled,
}: {
  query: string;
  generation: number;
  select: (row: ReportPurchase) => void;
  disabled: boolean;
}) {
  const t = useTranslations();
  const [rows, setRows] = useState<ReportPurchase[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const c = new AbortController();
    void fetchReportPurchases(query, cursor, generation, c.signal)
      .then((page) => {
        if (c.signal.aborted) return;
        if (page.nextCursor && seen.current.has(page.nextCursor))
          throw Error("Purchase pagination did not advance.");
        if (cursor) seen.current.add(cursor);
        setRows((old) =>
          cursor
            ? [...new Map([...old, ...page.items].map((row) => [row.id, row])).values()]
            : page.items
        );
        setNext(page.nextCursor);
      })
      .catch((cause) => {
        if (!c.signal.aborted) {
          setRows([]);
          setNext(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [query, cursor, generation, revision]);
  return (
    <View style={{ gap: 8 }}>
      {busy && <ActivityIndicator />}
      {rows.map((row) => (
        <Button key={row.id} text={row.orderNo} disabled={disabled} onPress={() => select(row)} />
      ))}
      {!busy && !error && !rows.length && (
        <ThemedText>{t("contentReports.noPurchases")}</ThemedText>
      )}
      {!!error && (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Button
            text={t("common.retry")}
            disabled={busy || disabled}
            onPress={() => {
              setError("");
              setBusy(true);
              seen.current.clear();
              setCursor(null);
              setRevision((v) => v + 1);
            }}
          />
        </>
      )}
      {next && (
        <Button
          text={t("contentReports.more")}
          disabled={busy || disabled}
          onPress={() => {
            setBusy(true);
            setCursor(next);
          }}
        />
      )}
    </View>
  );
}
