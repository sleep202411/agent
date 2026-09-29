import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { AgreementCreate } from "./agreement-create";
import { AgreementDetail } from "./agreement-detail";
import {
  agreementViews,
  fetchCrewAgreements,
  type AgreementPage,
  type AgreementView,
} from "./crew-agreements-api";
type Props = { crewId: string; userId: string; generation: number; onClose: () => void };
export function CrewAgreements(props: Props) {
  const active = useScreenActive();
  return active && props.generation === getAuthGeneration() ? (
    <Session key={`${props.crewId}:${props.userId}:${props.generation}`} {...props} />
  ) : null;
}
function Session(props: Props) {
  const t = useTranslations();
  const [view, setView] = useState<AgreementView>("all"),
    [revision, setRevision] = useState(0);
  return (
    <View style={{ flex: 1 }}>
      <ThemedText>{t("crewAgreements.title")}</ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {agreementViews.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === value }}
            style={{ padding: 12 }}
            onPress={() => setView(value)}
          >
            <ThemedText>{t(`crewAgreements.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      <Listing
        key={`${view}:${revision}`}
        {...props}
        view={view}
        created={() => {
          setView("all");
          setRevision((n) => n + 1);
        }}
        refresh={() => setRevision((n) => n + 1)}
      />
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
  );
}
function Listing(props: Props & { view: AgreementView; refresh: () => void; created: () => void }) {
  const t = useTranslations();
  const [page, setPage] = useState<AgreementPage>(),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<AgreementPage["items"][number]>();
  const collected = useRef<AgreementPage["items"]>([]),
    seen = useRef(new Set<string>()),
    requesting = useRef(false);
  useEffect(() => {
    const c = new AbortController();
    requesting.current = true;
    void fetchCrewAgreements(props.crewId, props.view, cursor, c.signal)
      .then((next) => {
        if (c.signal.aborted || props.generation !== getAuthGeneration()) return;
        if (
          next.items.some((item) => collected.current.some((old) => old.id === item.id)) ||
          (next.nextCursor !== null && seen.current.has(next.nextCursor))
        )
          throw new Error("Agreement pagination changed. Refresh to reload.");
        if (cursor) seen.current.add(cursor);
        collected.current = [...collected.current, ...next.items];
        setPage({ ...next, items: collected.current });
      })
      .catch((cause) => {
        if (!c.signal.aborted && props.generation === getAuthGeneration()) {
          setPage(undefined);
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
  }, [props.crewId, props.view, props.generation, cursor]);
  if (creating && page?.capabilities.create)
    return <AgreementCreate {...props} onClose={props.refresh} onSaved={props.created} />;
  if (selected)
    return (
      <AgreementDetail
        crewId={props.crewId}
        userId={props.userId}
        generation={props.generation}
        agreementId={selected.id}
        memberUserId={selected.memberUserId}
        closeLabel={t("crewAgreements.backToList")}
        onClose={props.refresh}
      />
    );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <ThemedText>{t("crewAgreements.scopeHelp")}</ThemedText>
      {page?.capabilities.create && (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 12 }}
          onPress={() => setCreating(true)}
        >
          <ThemedText>{t("agreementCreate.title")}</ThemedText>
        </Pressable>
      )}
      {page && (
        <View>
          {agreementViews.map((value) => (
            <ThemedText key={value}>
              {t(`crewAgreements.${value}`)} · {page.summary[value]}
            </ThemedText>
          ))}
        </View>
      )}
      {page?.items.length === 0 && <ThemedText>{t("crewAgreements.empty")}</ThemedText>}
      {page?.items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          style={{ paddingVertical: 12, gap: 6 }}
          onPress={() => {
            if (props.generation === getAuthGeneration()) setSelected(item);
          }}
        >
          <ThemedText>
            {item.title} · {t("agreementDetail.open")}
          </ThemedText>
          <ThemedText>
            {item.signerName} · {item.memberUserId}
          </ThemedText>
          <ThemedText>{t(`agreementDetail.status_${item.status}`)}</ThemedText>
          <ThemedText>
            {t("agreementDetail.updatedAt")} · {new Date(item.updatedAt).toLocaleString()}
          </ThemedText>
        </Pressable>
      ))}
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {page?.nextCursor && !error && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
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
