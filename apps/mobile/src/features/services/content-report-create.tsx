import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { reportIpContent } from "@/data/ip-api";
import { IpReportSheet } from "@/features/ip-community/ip-report-sheet";
import type { ReportDraft } from "@/features/ip-community/use-ip-moderation";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { fetchReportTargets } from "./content-report-targets";
type Props = {
  userId: string;
  generation: number;
  active: boolean;
  onClose: () => void;
  onSaved: () => void;
};
export function ContentReportCreate(props: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    locale = useLocale();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [draft, setDraft] = useState<ReportDraft>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const pending = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && props.generation === getAuthGeneration();
  return (
    <View style={{ flex: 1, display: props.active ? "flex" : "none", padding: 16, gap: 12 }}>
      <ThemedText type="smallBold">{t("contentReports.newReport")}</ThemedText>
      <TextInput
        accessibilityLabel={t("contentReports.search")}
        value={query}
        onChangeText={setQuery}
        editable={!busy}
        style={{ color: theme.text, borderColor: theme.border, borderWidth: 1, padding: 12 }}
      />
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => setSearch(query.trim())}
        style={{ paddingVertical: 12 }}
      >
        <ThemedText>{t("contentReports.search")}</ThemedText>
      </Pressable>
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {props.active && (
        <Targets
          key={`${search}:${locale}`}
          query={search}
          locale={locale}
          generation={props.generation}
          select={(value) => {
            if (!current() || pending.current) return;
            setDraft((old) =>
              old?.targetId === value.id
                ? old
                : {
                    targetType: "ip",
                    targetId: value.id,
                    title: value.title,
                    reason: "copyright",
                    description: "",
                    blockIp: false,
                  }
            );
            setError("");
            setOpen(true);
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={props.onClose}
        style={{ paddingVertical: 12 }}
      >
        <ThemedText>{t("common.cancel")}</ThemedText>
      </Pressable>
      {draft && (
        <IpReportSheet
          visible={props.active && open}
          submitting={busy}
          accepted={false}
          allowBlock={false}
          draft={draft}
          onChange={(changes) => {
            if (!pending.current) setDraft({ ...draft, ...changes, blockIp: false });
          }}
          onClose={() => {
            if (!pending.current) setOpen(false);
          }}
          onSubmit={() => {
            if (!props.active || !current() || pending.current) return;
            pending.current = true;
            setBusy(true);
            setError("");
            void reportIpContent({
              targetType: "ip",
              targetId: draft.targetId,
              reason: draft.reason,
              description: draft.description,
            })
              .then(
                () => {
                  if (current()) props.onSaved();
                },
                (cause) => {
                  if (current()) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                    setOpen(false);
                  }
                }
              )
              .finally(() => {
                pending.current = false;
                if (current()) setBusy(false);
              });
          }}
        />
      )}
    </View>
  );
}
function Targets(props: {
  query: string;
  locale: string;
  generation: number;
  select: (row: { id: string; title: string }) => void;
}) {
  const t = useTranslations();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof fetchReportTargets>>["items"]>([]);
  const [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const c = new AbortController();
    void fetchReportTargets(props.query, props.locale, cursor, props.generation, c.signal)
      .then(
        (page) => {
          if (c.signal.aborted) return;
          if (page.nextCursor && seen.current.has(page.nextCursor)) {
            setRows([]);
            setNext(null);
            setError("Content pagination changed. Refresh to reload.");
            return;
          }
          if (cursor) seen.current.add(cursor);
          setRows((old) =>
            cursor
              ? [...new Map([...old, ...page.items].map((row) => [row.id, row])).values()]
              : page.items
          );
          setNext(page.nextCursor);
        },
        (cause) => {
          if (!c.signal.aborted) {
            setRows([]);
            setNext(null);
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }
      )
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [props.query, props.locale, props.generation, cursor, revision]);
  return (
    <ScrollView contentContainerStyle={{ gap: 8 }}>
      {busy && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!busy && !error && !rows.length && <ThemedText>{t("contentReports.empty")}</ThemedText>}
      {rows.map((row) => (
        <Pressable
          key={row.id}
          accessibilityRole="button"
          onPress={() => props.select(row)}
          style={{ paddingVertical: 12 }}
        >
          <ThemedText>
            {row.title} · {row.roomNumber}
          </ThemedText>
        </Pressable>
      ))}
      {!!error && (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError("");
            setBusy(true);
            seen.current.clear();
            setCursor(null);
            setRevision((v) => v + 1);
          }}
        >
          <ThemedText>{t("common.retry")}</ThemedText>
        </Pressable>
      )}
      {next && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            setBusy(true);
            setCursor(next);
          }}
        >
          <ThemedText>{t("crewFinance.more")}</ThemedText>
        </Pressable>
      )}
    </ScrollView>
  );
}
