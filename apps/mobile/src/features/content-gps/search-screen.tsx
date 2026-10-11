import { MapPanel } from "../discovery-map/map-panel";
import { readDiscoveryMapConfig } from "../discovery-map/environment";
import { gpsMapFeatures } from "../discovery-map/features";
import type { GpsViewport } from "../discovery-map/content-gps-map-types";
import { gpsPlaybackPath } from "./playback-entry";
import { DiscoveryAssistantPanel } from "@/features/discovery-assistant/discovery-assistant-panel";
import { useIpBookmark } from "@/features/ip-collection/use-ip-bookmark";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { z } from "zod";
import { useAuth, useAuthGate } from "@/auth";
import { isChinaRegion } from "@/config";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { api } from "@/lib/api-client";
import { toHref } from "@/lib/navigation";
import { useGpsSearch } from "./use-gps-search";
import {
  EMPTY_GPS_DRAFT,
  gpsLinkKeys,
  gpsDraftFromQuery,
  gpsDraftUrl,
  normalizeGpsDraft,
  readGpsLink,
  type GpsSearchDraft,
} from "./search-draft";
import type { GpsPage } from "./search-api";
function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ minHeight: 44, paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false),
    theme = useTheme();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{
          minHeight: 44,
          padding: 10,
          borderRadius: 8,
          backgroundColor: theme.backgroundElement,
        }}
      >
        <ThemedText>
          {label}: {options.find(([v]) => v === value)?.[1] ?? value}
        </ThemedText>
      </Pressable>
      {open &&
        options.map(([v, name]) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            aria-checked={value === v}
            accessibilityLabel={`${label}: ${name}`}
            accessibilityState={{ selected: value === v }}
            onPress={() => {
              onChange(v);
              setOpen(false);
            }}
            style={{ minHeight: 44, padding: 10 }}
          >
            <ThemedText>{name}</ThemedText>
          </Pressable>
        ))}
    </View>
  );
}
function Field({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <ThemedText>{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        maxLength={numeric ? 20 : 100}
        keyboardType={numeric ? "numbers-and-punctuation" : "default"}
        style={{
          minHeight: 44,
          padding: 10,
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          borderRadius: 8,
        }}
      />
    </View>
  );
}
function Card({
  item,
  select,
  selected = false,
}: {
  item: GpsPage["items"][number];
  select: () => void;
  selected?: boolean;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    router = useRouter();
  return (
    <View
      style={{
        gap: 8,
        padding: 12,
        marginVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      {item.coverUrl && (
        <Image
          source={{ uri: item.coverUrl }}
          contentFit="cover"
          style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8 }}
          accessibilityLabel={item.title}
        />
      )}
      <ThemedText type="smallBold">{item.title}</ThemedText>
      <ThemedText>{item.summary}</ThemedText>
      {selected && (
        <ThemedText>
          {t(item.matched ? "contentGpsDiscovery.matches" : "contentGpsDiscovery.outsideQuery")}
        </ThemedText>
      )}
      <ThemedText>
        {item.locations.map((v) => v.label).join(" · ") || t("contentGpsDiscovery.unknownLocation")}
      </ThemedText>
      {item.eras.map((era, i) => (
        <ThemedText key={i}>
          {era.startYear}–{era.endYear}
        </ThemedText>
      ))}
      <ThemedText>
        {item.episode?.durationSeconds != null
          ? t("contentGpsDiscovery.episodeSeconds").replace(
              "{count}",
              String(item.episode.durationSeconds)
            )
          : t("contentGpsDiscovery.unknownDuration")}
      </ThemedText>
      {!selected && (
        <Action
          label={t("contentGpsDiscovery.selectTitle").replace("{title}", item.title)}
          onPress={select}
        />
      )}
      {selected && (
        <Action
          label={t("contentGpsDiscovery.play")}
          onPress={() => router.push(toHref(gpsPlaybackPath(item.id, item.episode?.id)))}
        />
      )}
      <Action
        label={t("contentGpsDiscovery.details")}
        onPress={() => router.push(toHref(`/ip/${item.id}`))}
      />
    </View>
  );
}
const subscribe = () => () => {},
  clientReady = () => true,
  serverReady = () => false;
export function GpsSearchScreen() {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady),
    params = useLocalSearchParams();
  const fingerprint = JSON.stringify(
    Object.fromEntries(gpsLinkKeys.map((key) => [key, params[key]]))
  );
  const initial = useMemo(() => readGpsLink(JSON.parse(fingerprint)), [fingerprint]);
  return ready ? <Content key={fingerprint} initial={initial} /> : <ActivityIndicator />;
}
function Content({ initial }: { initial: ReturnType<typeof readGpsLink> }) {
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive(),
    locale = useLocale(),
    t = useTranslations(),
    theme = useTheme(),
    router = useRouter();
  const mapConfig = useMemo(() => readDiscoveryMapConfig(), []);
  const [mapOpen, setMapOpen] = useState(false);
  const [viewport, setViewport] = useState<GpsViewport>(() => ({
    coordinateSystem: isChinaRegion ? "GCJ02" : "WGS84",
    west: -180,
    east: 180,
    south: -80,
    north: 80,
  }));
  const normalized = useMemo(() => normalizeGpsDraft(initial.draft, locale), [initial, locale]);
  const fallback = useMemo(() => normalizeGpsDraft(EMPTY_GPS_DRAFT, locale), [locale]);
  const query = normalized.success ? normalized.data : fallback.data!;
  const valid = normalized.success && !initial.invalid;
  const [draft, setDraft] = useState<GpsSearchDraft>(initial.draft),
    [filters, setFilters] = useState(!valid),
    [assistantOpened, setAssistantOpened] = useState(false),
    [placeText, setPlaceText] = useState(""),
    [placeSearch, setPlaceSearch] = useState("");
  const options = useMemo(
    () => ({
      viewport: mapOpen ? viewport : undefined,
      selectedIpId: initial.selected,
      placeSearch,
      coordinateSystem: isChinaRegion ? ("GCJ02" as const) : ("WGS84" as const),
    }),
    [initial.selected, placeSearch, mapOpen, viewport]
  );
  const viewerId =
    auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : null;
  const state = useGpsSearch(
    { generation: auth.generation, viewerId },
    query,
    locale,
    active && auth.status !== "hydrating" && valid,
    options
  );
  const mapFeatures = useMemo(
    () =>
      mapOpen && state.page
        ? gpsMapFeatures(state.page, (count, matched) =>
            t(matched ? "discoveryMap.matches" : "discoveryMap.other").replace(
              "{count}",
              String(count)
            )
          )
        : [],
    [state.page, t, mapOpen]
  );
  const bookmark = useIpBookmark(
    auth.generation,
    viewerId,
    locale,
    state.page?.selected?.id ?? null,
    active && valid && auth.status !== "hydrating"
  );
  const genres = useGpsGenres(locale, active && (filters || assistantOpened));
  const parsed = normalizeGpsDraft(draft, locale),
    dirty = gpsDraftUrl(draft) !== gpsDraftUrl(initial.draft);
  type LabelKey =
    Extract<
      Parameters<typeof t>[0],
      `contentGpsDiscovery.${string}`
    > extends `contentGpsDiscovery.${infer K}`
      ? K
      : never;
  const label = (key: LabelKey) => t(`contentGpsDiscovery.${key}`);
  const assistantQuery = parsed.success ? parsed.data : query;
  const apply = (next: GpsSearchDraft, selected: string | null = null) => {
    const p = new URLSearchParams(gpsDraftUrl(next));
    if (selected) p.set("selected", selected);
    if (gpsDraftUrl(next) === gpsDraftUrl(initial.draft) && selected === initial.selected)
      state.refresh();
    router.replace(toHref(`/content-gps${p.size ? `?${p}` : ""}`));
    setFilters(false);
  };
  const toggle = (key: "places" | "genres", value: string) =>
    setDraft((v) => ({
      ...v,
      [key]: v[key].includes(value)
        ? v[key].filter((s) => s !== value)
        : v[key].length < 8
          ? [...v[key], value]
          : v[key],
    }));
  const places = new Map(
    (
      state.page?.places.filter((v) => v.kind === (draft.locationKind ?? "story_setting")) ?? []
    ).map((v) => [v.id, v.label])
  );
  draft.places.forEach((id) => {
    if (!places.has(id)) places.set(id, id.replace(/^label:/, ""));
  });
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: label("title"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      <FlatList
        data={state.items.filter(
          (v) => !(initial.selected === v.id && state.page && !state.page.selected)
        )}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <Card item={item} select={() => apply(initial.draft, item.id)} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <ThemedText>{label("description")}</ThemedText>
            {mapConfig && (
              <View style={{ gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: mapOpen }}
                  onPress={() => setMapOpen(!mapOpen)}
                  style={{ minHeight: 44, paddingVertical: 12 }}
                >
                  <ThemedText>{t(mapOpen ? "discoveryMap.hide" : "discoveryMap.show")}</ThemedText>
                </Pressable>
                {mapOpen && active && valid && auth.status !== "hydrating" && (
                  <MapPanel
                    key={`${auth.generation}:${locale}`}
                    config={mapConfig}
                    viewport={viewport}
                    features={mapFeatures}
                    onViewport={setViewport}
                    onSelect={(id) => router.push(toHref(`/ip/${encodeURIComponent(id)}`))}
                  />
                )}
              </View>
            )}
            <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
              <Action label={label("catalogue")} onPress={() => router.push(toHref("/ips"))} />
              <Action
                label={label("creatorMode")}
                onPress={() => router.push(toHref("/studios"))}
              />
            </View>
            <DiscoveryAssistantPanel
              key={`${auth.generation}:${viewerId}:${locale}:ips`}
              scope={{ userId: viewerId ?? "", generation: auth.generation, locale, kind: "ips" }}
              current={{
                kind: "ips",
                query: {
                  schemaVersion: 1,
                  location: assistantQuery.location,
                  era: assistantQuery.era,
                  duration: assistantQuery.duration,
                  genreCodes: assistantQuery.genreCodes,
                  moodPreferences: assistantQuery.moodPreferences,
                },
              }}
              genreLabels={genres.data?.items}
              onOpen={() => setAssistantOpened(true)}
              valid={parsed.success && !initial.invalid}
              onReview={(result) => {
                if (result.kind === "ips") {
                  setDraft(gpsDraftFromQuery(result.query));
                  setFilters(true);
                }
              }}
              onApply={(result) => {
                if (result.kind === "ips") apply(gpsDraftFromQuery(result.query));
              }}
              onSelect={(result, id) => {
                if (result.kind === "ips") apply(gpsDraftFromQuery(result.query), id);
              }}
            />
            <Action label={label("conditions")} onPress={() => setFilters(!filters)} />
            {!valid && (
              <View>
                <ThemedText accessibilityRole="alert">{label("invalidLink")}</ThemedText>
                <Action label={label("reset")} onPress={() => apply(EMPTY_GPS_DRAFT)} />
              </View>
            )}
            {filters && (
              <View style={{ gap: 12 }}>
                <Choice
                  label={label("locationKind")}
                  value={draft.locationKind ?? "story_setting"}
                  options={[
                    ["story_setting", label("storyPlaces")],
                    ["production_origin", label("productionPlaces")],
                  ]}
                  onChange={(locationKind) => setDraft({ ...draft, locationKind, places: [] })}
                />
                <Choice
                  label={label("locationRelation")}
                  value={draft.locationRelation ?? "any"}
                  options={[
                    ["any", label("anyPlace")],
                    ["all", label("allPlaces")],
                  ]}
                  onChange={(locationRelation) => setDraft({ ...draft, locationRelation })}
                />
                <Field label={label("findPlace")} value={placeText} onChange={setPlaceText} />
                <Action
                  label={label("findPlace")}
                  onPress={() => {
                    if (placeText === placeSearch) state.refresh();
                    setPlaceSearch(placeText);
                  }}
                  disabled={!valid || !active}
                />
                <ScrollView
                  style={{ maxHeight: 180 }}
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {[...places].map(([id, name]) => (
                    <Pressable
                      key={id}
                      aria-checked={draft.places.includes(id)}
                      accessibilityRole="checkbox"
                      accessibilityLabel={name}
                      accessibilityState={{
                        checked: draft.places.includes(id),
                        disabled: !draft.places.includes(id) && draft.places.length >= 8,
                      }}
                      disabled={!draft.places.includes(id) && draft.places.length >= 8}
                      onPress={() => toggle("places", id)}
                      style={{ minHeight: 44, padding: 10 }}
                    >
                      <ThemedText>
                        {draft.places.includes(id) ? "✓ " : ""}
                        {name}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
                {state.page?.placesTruncated && <ThemedText>{label("refinePlaces")}</ThemedText>}
                <ThemedText>{label("genre")}</ThemedText>
                <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                  {[
                    ...new Map([
                      ...(genres.data?.items ?? []).map((v) => [v.code, v.label] as const),
                      ...draft.genres
                        .filter((code) => !genres.data?.items.some((v) => v.code === code))
                        .map((code) => [code, code] as const),
                    ]),
                  ].map(([code, name]) => (
                    <Pressable
                      key={code}
                      accessibilityRole="checkbox"
                      accessibilityLabel={name}
                      aria-checked={draft.genres.includes(code)}
                      accessibilityState={{ checked: draft.genres.includes(code) }}
                      disabled={!draft.genres.includes(code) && draft.genres.length >= 8}
                      onPress={() => toggle("genres", code)}
                      style={{ minHeight: 44, padding: 10 }}
                    >
                      <ThemedText>
                        {draft.genres.includes(code) ? "✓ " : ""}
                        {name}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
                {genres.isFetching && <ActivityIndicator />}
                {genres.error && (
                  <View>
                    <ThemedText accessibilityRole="alert">{genres.error.message}</ThemedText>
                    <Action label={label("retry")} onPress={() => void genres.refetch()} />
                  </View>
                )}
                <Field
                  numeric
                  label={label("fromYear")}
                  value={draft.startYear}
                  onChange={(startYear) => setDraft({ ...draft, startYear })}
                />
                <Field
                  numeric
                  label={label("toYear")}
                  value={draft.endYear}
                  onChange={(endYear) => setDraft({ ...draft, endYear })}
                />
                <Choice
                  label={label("eraRelation")}
                  value={draft.eraRelation ?? "overlaps"}
                  options={[
                    ["overlaps", label("overlappingEra")],
                    ["contained", label("containedEra")],
                  ]}
                  onChange={(eraRelation) => setDraft({ ...draft, eraRelation })}
                />
                <Field
                  numeric
                  label={label("maxSeconds")}
                  value={draft.maxSeconds}
                  onChange={(maxSeconds) => setDraft({ ...draft, maxSeconds })}
                />
                <Choice
                  label={label("unknownDuration")}
                  value={draft.unknownDuration ?? "exclude"}
                  options={[
                    ["exclude", label("excludeUnknown")],
                    ["include_labelled", label("includeUnknown")],
                  ]}
                  onChange={(unknownDuration) => setDraft({ ...draft, unknownDuration })}
                />
                <ThemedText>
                  {label(
                    draft.unknownDuration === "include_labelled"
                      ? "durationPolicyInclude"
                      : "durationPolicy"
                  )}
                </ThemedText>
                {(draft.durationUnit === "film" || Boolean(draft.moods?.length)) && (
                  <ThemedText accessibilityRole="alert">
                    {label("unsupportedConditions")}
                  </ThemedText>
                )}
                {!parsed.success && (
                  <ThemedText accessibilityRole="alert">{label("invalid")}</ThemedText>
                )}
                {dirty && <ThemedText>{label("unapplied")}</ThemedText>}
                <Action
                  label={label("search")}
                  disabled={!parsed.success || initial.invalid || !active}
                  onPress={() => apply(draft)}
                />
                <Action label={label("reset")} onPress={() => apply(EMPTY_GPS_DRAFT)} />
              </View>
            )}
            {state.error && (
              <View>
                <ThemedText accessibilityRole="alert">{state.error}</ThemedText>
                <Action label={label("retry")} onPress={state.retry} />
              </View>
            )}
            {state.loading && <ActivityIndicator accessibilityLabel={label("loading")} />}
            {initial.selected && (
              <View>
                <ThemedText type="smallBold">{label("selection")}</ThemedText>
                {state.page?.selected ? (
                  <>
                    <Card selected item={state.page.selected} select={() => {}} />
                    <Action
                      label={label(
                        bookmark.busy ? "loading" : bookmark.saved ? "removeBookmark" : "bookmark"
                      )}
                      disabled={!active || Boolean(viewerId && (bookmark.busy || !bookmark.known))}
                      onPress={() => {
                        if (viewerId) void bookmark.toggle();
                        else gate.requireAuth();
                      }}
                    />
                    {bookmark.error && (
                      <ThemedText accessibilityRole="alert">{bookmark.error}</ThemedText>
                    )}
                    {viewerId && !bookmark.known && !bookmark.busy && (
                      <Action label={label("retry")} onPress={bookmark.retry} />
                    )}
                  </>
                ) : (
                  state.page && <ThemedText>{label("selectionUnavailable")}</ThemedText>
                )}
                <Action label={label("clearSelection")} onPress={() => apply(initial.draft)} />
              </View>
            )}
            {state.page && (
              <ThemedText>
                {label("count")
                  .replace("{matched}", String(state.page.matchedCount))
                  .replace("{count}", String(state.page.accessibleCount))}
              </ThemedText>
            )}
            {state.page && !state.items.length && <ThemedText>{label("empty")}</ThemedText>}
          </View>
        }
        ListFooterComponent={
          state.hasMore ? (
            <Action
              label={label("more")}
              onPress={state.loadMore}
              disabled={state.loading || !!state.error || !active}
            />
          ) : null
        }
      />
    </View>
  );
}

function useGpsGenres(locale: string, enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data?: { items: { code: string; label: string }[] };
    error?: Error;
  }>();
  const key = JSON.stringify([locale, enabled, revision]);
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    void api
      .get("/ip-commerce/taxonomy", {
        service: "aurora",
        credentials: "omit",
        retry: false,
        signal: c.signal,
        params: { type: "genre", locale },
      })
      .then((raw) => {
        const data = z
          .object({ items: z.array(z.object({ code: z.string(), label: z.string() })) })
          .parse(raw);
        if (!c.signal.aborted) setSnapshot({ key, data });
      })
      .catch((error) => {
        if (!c.signal.aborted)
          setSnapshot({ key, error: error instanceof Error ? error : new Error(String(error)) });
      });
    return () => c.abort();
  }, [key, locale, enabled]);
  const value = enabled && snapshot?.key === key ? snapshot : undefined;
  return {
    data: value?.data,
    error: value?.error,
    isFetching: enabled && !value,
    refetch: () => setRevision((v) => v + 1),
  };
}
