import { PurchaseReportCreate } from "./purchase-report-create";
import { ContentReportCreate } from "./content-report-create";
import { useEffect, useRef, useState } from "react";
import { useIsFocused } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  reportViews,
  type ReportView,
  fetchContentReports,
  type ContentReport,
} from "./content-reports-api";
type Props = { userId: string; generation: number };
export function ContentReports(props: Props) {
  const focused = useIsFocused();
  return focused && props.generation === getAuthGeneration() ? (
    <Session key={`${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const active = useScreenActive();
  const [view, setView] = useState<ReportView>("initiated");
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState<"content" | "purchase" | null>(null);
  const Create = creating === "purchase" ? PurchaseReportCreate : ContentReportCreate;
  if (creating)
    return (
      <Create
        {...props}
        active={active}
        onClose={() => setCreating(null)}
        onSaved={() => {
          setCreating(null);
          setView("initiated");
          setRevision((v) => v + 1);
        }}
      />
    );
  if (!active) return null;
  return (
    <View style={{ flex: 1 }}>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 16 }}
        onPress={() => setCreating("content")}
      >
        <ThemedText>{t("contentReports.newReport")}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        style={{ padding: 16 }}
        onPress={() => setCreating("purchase")}
      >
        <ThemedText>{t("contentReports.newPurchaseReport")}</ThemedText>
      </Pressable>
      <View
        accessibilityRole="tablist"
        style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16 }}
      >
        {reportViews.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            aria-selected={view === value}
            onPress={() => setView(value)}
            style={{
              padding: 12,
              borderBottomWidth: 2,
              borderBottomColor: view === value ? theme.brand : "transparent",
            }}
          >
            <ThemedText>{t(`contentReports.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      <Listing key={`${view}:${revision}`} {...props} view={view} />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 16 }}
        onPress={() => setRevision((v) => v + 1)}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Listing(props: Props & { view: ReportView }) {
  const t = useTranslations(),
    locale = useLocale();
  const [rows, setRows] = useState<ContentReport[]>([]);
  const [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const collected = useRef<ContentReport[]>([]),
    seen = useRef(new Set<string>()),
    requesting = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    requesting.current = true;
    void fetchContentReports(props.generation, props.view, cursor, c.signal)
      .then((page) => {
        if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
        if (
          page.items.some((row) => collected.current.some((old) => old.id === row.id)) ||
          (page.nextCursor !== null && seen.current.has(page.nextCursor))
        )
          throw new Error("Report pagination changed. Refresh to reload.");
        if (cursor) seen.current.add(cursor);
        collected.current = [...collected.current, ...page.items];
        setRows(collected.current);
        setNext(page.nextCursor);
      })
      .catch((cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          setRows([]);
          setNext(null);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          requesting.current = false;
          setBusy(false);
        }
      });
    return () => c.abort();
  }, [props.generation, props.view, cursor]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>
        {t(
          props.view === "responses"
            ? "contentReports.responsesHint"
            : "contentReports.initiatedHint"
        )}
      </ThemedText>
      {busy && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!busy && !error && !rows.length && <ThemedText>{t("contentReports.empty")}</ThemedText>}
      {rows.map((row) => (
        <View key={row.id} style={{ paddingVertical: 12, gap: 6 }}>
          <ThemedText type="smallBold">{t(`contentReports.reason.${row.reason}`)}</ThemedText>
          {row.purchaseOrderId && (
            <ThemedText>
              {t("contentReports.purchaseReference").replace("{id}", row.purchaseOrderId)}
            </ThemedText>
          )}
          <ThemedText>
            {t(`contentReports.status.${row.status}`)} ·{" "}
            {new Date(row.createdAt).toLocaleDateString(locale)}
          </ThemedText>
          <ThemedText selectable>
            {t("contentReports.reference").replace("{{id}}", row.id)}
          </ThemedText>
          {!!row.description && <ThemedText selectable>{row.description}</ThemedText>}
          {!!row.resolutionNote && <ThemedText selectable>{row.resolutionNote}</ThemedText>}
        </View>
      ))}
      {next && !error && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={{ padding: 12 }}
          onPress={() => {
            if (!requesting.current) {
              requesting.current = true;
              setBusy(true);
              setCursor(next);
            }
          }}
        >
          <ThemedText>{t("crewFinance.more")}</ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}
