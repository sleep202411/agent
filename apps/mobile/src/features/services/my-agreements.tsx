import { useEffect, useRef, useState } from "react";
import { useIsFocused } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { AgreementDetail } from "./agreement-detail";
import { agreementViews, type AgreementView } from "./crew-agreements-api";
import { fetchMyAgreements, type MyAgreement } from "./my-agreements-api";
type Props = { userId: string; generation: number };
export function MyAgreements(props: Props) {
  const focused = useIsFocused();
  return focused && props.generation === getAuthGeneration() ? (
    <Session key={`${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations(),
    theme = useTheme();
  const active = useScreenActive();
  const [view, setView] = useState<AgreementView>("all");
  const [selected, setSelected] = useState<MyAgreement>();
  const [revision, setRevision] = useState(0);
  if (selected)
    return (
      <AgreementDetail
        {...props}
        crewId={selected.crewId}
        agreementId={selected.id}
        closeLabel={t("crewAgreements.backToList")}
        onClose={() => setSelected(undefined)}
      />
    );
  if (!active) return null;
  return (
    <View style={{ flex: 1 }}>
      <View
        accessibilityRole="tablist"
        style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16 }}
      >
        {agreementViews.map((value) => (
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
            <ThemedText>{t(`crewAgreements.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      <Listing key={`${view}:${revision}`} {...props} view={view} select={setSelected} />
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
function Listing(props: Props & { view: AgreementView; select: (item: MyAgreement) => void }) {
  const t = useTranslations(),
    locale = useLocale();
  const [rows, setRows] = useState<MyAgreement[]>([]);
  const [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  const collected = useRef<MyAgreement[]>([]),
    seen = useRef(new Set<string>()),
    requesting = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    requesting.current = true;
    void fetchMyAgreements(props.generation, props.view, cursor, c.signal)
      .then((page) => {
        if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
        if (
          page.items.some((row) => collected.current.some((old) => old.id === row.id)) ||
          (page.nextCursor !== null && seen.current.has(page.nextCursor))
        )
          throw new Error("Agreement pagination changed. Refresh to reload.");
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
      <ThemedText>{t("myAgreements.description")}</ThemedText>
      {busy && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!busy && !error && !rows.length && <ThemedText>{t("crewAgreements.empty")}</ThemedText>}
      {rows.map((row) => (
        <Pressable
          key={row.id}
          accessibilityRole="button"
          style={{ paddingVertical: 12, gap: 4 }}
          onPress={() => {
            if (props.generation === getAuthGeneration()) props.select(row);
          }}
        >
          <ThemedText type="smallBold">{row.title}</ThemedText>
          <ThemedText>{row.crew.name}</ThemedText>
          <ThemedText>
            {t(`agreementDetail.status_${row.status}`)} ·{" "}
            {new Date(row.updatedAt).toLocaleDateString(locale)}
          </ThemedText>
        </Pressable>
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
