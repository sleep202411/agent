import { MapPanel } from "../discovery-map/map-panel";
import { readDiscoveryMapConfig } from "../discovery-map/environment";
import { studioMapFeatures } from "../discovery-map/features";
import type { GpsViewport } from "../discovery-map/content-gps-map-types";
import { isChinaRegion } from "@/config";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Stack, useRouter, useLocalSearchParams } from "expo-router";
import { SERVICE_CATEGORIES } from "@repo/shared/creator-service";
import { REGIONS, regionLabel } from "@repo/shared/regions";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { serviceCategoryLabel } from "@/lib/creator-service-format";
import { toHref } from "@/lib/navigation";
import { emptyStudioQuery, type StudioQuery, type StudioPage } from "./studio-search-api";
import { DiscoveryAssistantPanel } from "../discovery-assistant/discovery-assistant-panel";
import { useStudioSearch } from "./use-studio-search";
import {
  readStudioLink,
  studioLinkKeys,
  parseStudioDraft,
  studioDraftFromQuery,
  studioLinkParams,
  type StudioDraft,
} from "./studio-search-link";

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
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={{ paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
function PlaceFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: StudioQuery["basedIn"];
  onChange: (v: StudioQuery["basedIn"]) => void;
}) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${t("studioDiscovery.country")}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ padding: 10, backgroundColor: theme.backgroundElement, borderRadius: 8 }}
      >
        <ThemedText>
          {regionLabel(value?.countryCode, locale) || t("studioDiscovery.anyPlace")}
        </ThemedText>
      </Pressable>
      {open && (
        <ScrollView
          style={{ maxHeight: 180 }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {REGIONS.filter((r) => r.code !== "GLOBAL").map((r) => (
            <Pressable
              key={r.code}
              accessibilityRole="radio"
              accessibilityState={{ selected: value?.countryCode === r.code }}
              onPress={() => {
                onChange({ countryCode: r.code, city: value?.city ?? "" });
                setOpen(false);
              }}
              style={{ padding: 10 }}
            >
              <ThemedText>{regionLabel(r.code, locale)}</ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <TextInput
        accessibilityLabel={`${label}: ${t("studioDiscovery.city")}`}
        value={value?.city ?? ""}
        maxLength={150}
        onChangeText={(city) => onChange({ countryCode: value?.countryCode ?? "", city })}
        placeholder={t("studioDiscovery.city")}
        placeholderTextColor={theme.textSecondary}
        style={{
          padding: 10,
          color: theme.text,
          backgroundColor: theme.backgroundElement,
          borderRadius: 8,
        }}
      />
      {value && (
        <Action
          label={t("studioDiscovery.clearPlace").replace("{place}", label)}
          onPress={() => {
            onChange(null);
            setOpen(false);
          }}
        />
      )}
    </View>
  );
}
function StudioCard({ studio }: { studio: StudioPage["items"][number] }) {
  const theme = useTheme(),
    t = useTranslations(),
    locale = useLocale(),
    router = useRouter();
  const place = (v: NonNullable<StudioQuery["basedIn"]>) =>
    `${v.city}, ${regionLabel(v.countryCode, locale)}`;
  const open = () => router.push(toHref(`/creator/${encodeURIComponent(studio.id)}`));
  return (
    <View
      style={{
        padding: 12,
        gap: 8,
        borderRadius: 8,
        backgroundColor: theme.backgroundElement,
        marginBottom: 12,
      }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={open}
        style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        {!!studio.avatarUrl && (
          <Image
            source={{ uri: studio.avatarUrl }}
            style={{ width: 44, height: 44, borderRadius: 22 }}
            contentFit="cover"
          />
        )}
        <ThemedText type="smallBold" style={{ flex: 1 }}>
          {studio.name}
        </ThemedText>
      </Pressable>
      {studio.showOnMap && studio.basedIn && (
        <ThemedText>
          {t("studioDiscovery.basedIn")}: {place(studio.basedIn)}
        </ThemedText>
      )}
      {!!studio.serves.length && (
        <ThemedText>
          {t("studioDiscovery.serves")}: {studio.serves.map(place).join(" · ")}
        </ThemedText>
      )}
      {studio.remote && <ThemedText>{t("studioDiscovery.remote")}</ThemedText>}
      {studio.openToWork && <ThemedText>{t("studioDiscovery.available")}</ThemedText>}
      <ThemedText>
        {t("studioDiscovery.services").replace("{count}", String(studio.matchingServiceCount))}
      </ThemedText>
      <Action
        label={t("studioDiscovery.viewStudio")}
        onPress={() =>
          router.push(toHref(`/creator/${encodeURIComponent(studio.id)}?section=services`))
        }
      />
    </View>
  );
}
const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
export function StudioSearchScreen() {
  // Static exports have no query string; match their shell before reading an incoming link.
  const ready = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const params = useLocalSearchParams();
  const fingerprint = JSON.stringify(
    Object.fromEntries(studioLinkKeys.map((key) => [key, params[key] ?? ""]))
  );
  const initial = useMemo(() => readStudioLink(JSON.parse(fingerprint)), [fingerprint]);
  if (!ready) return <ActivityIndicator />;
  return <StudioSearchContent key={fingerprint} initial={initial} />;
}
function StudioSearchContent({ initial }: { initial: ReturnType<typeof readStudioLink> }) {
  const router = useRouter();
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive(),
    t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const mapConfig = useMemo(() => readDiscoveryMapConfig(), []);
  const [mapOpen, setMapOpen] = useState(false);
  const [viewport, setViewport] = useState<GpsViewport>(() => ({
    coordinateSystem: isChinaRegion ? "GCJ02" : "WGS84",
    west: -180,
    east: 180,
    south: -80,
    north: 80,
  }));
  const normalized = useMemo(() => parseStudioDraft(initial.draft), [initial]);
  const query = normalized.success ? normalized.data : emptyStudioQuery;
  const validLink = normalized.success && !initial.invalid;
  const [draft, setDraft] = useState<StudioDraft>(initial.draft),
    [filters, setFilters] = useState(!validLink);
  const state = useStudioSearch(
    {
      generation: auth.generation,
      viewerId:
        auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : null,
    },
    query,
    locale,
    active && auth.status !== "hydrating" && validLink,
    initial.selected,
    mapOpen ? viewport : null
  );
  const mapFeatures = useMemo(
    () =>
      mapOpen && state.page
        ? studioMapFeatures(state.page, (count, matched) =>
            t(matched ? "discoveryMap.matches" : "discoveryMap.other").replace(
              "{count}",
              String(count)
            )
          )
        : [],
    [state.page, t, mapOpen]
  );
  const parsed = parseStudioDraft(draft),
    dirty = JSON.stringify(draft) !== JSON.stringify(initial.draft);
  const setSearch = (next: StudioQuery, selected: string | null = null) => {
    if (
      validLink &&
      JSON.stringify(next) === JSON.stringify(query) &&
      selected === initial.selected
    )
      state.refresh();
    router.setParams(studioLinkParams(next, selected));
    setDraft(studioDraftFromQuery(next));
    setFilters(false);
  };
  const apply = () => {
    if (!parsed.success || initial.invalid) return;
    setSearch(parsed.data);
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.background, padding: 16 }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("studioDiscovery.title"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={state.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <StudioCard studio={item} />}
        refreshing={state.loading}
        onRefresh={state.refresh}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 12 }}>
            <ThemedText>{t("studioDiscovery.description")}</ThemedText>
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
                {mapOpen && active && validLink && auth.status !== "hydrating" && (
                  <MapPanel
                    key={`${auth.generation}:${locale}`}
                    config={mapConfig}
                    viewport={viewport}
                    features={mapFeatures}
                    onViewport={setViewport}
                    onSelect={(id) => router.push(toHref(`/creator/${encodeURIComponent(id)}`))}
                  />
                )}
              </View>
            )}
            <DiscoveryAssistantPanel
              key={`${auth.generation}:${locale}`}
              scope={{
                userId:
                  auth.status === "authenticated"
                    ? String(auth.user?.userId ?? auth.user?.id ?? "")
                    : "",
                generation: auth.generation,
                locale,
                kind: "creators",
              }}
              current={{ kind: "creators", query: parsed.success ? parsed.data : query }}
              valid={parsed.success && !initial.invalid}
              onReview={(result) => {
                if (result.kind !== "creators") return;
                setDraft(studioDraftFromQuery(result.query));
                setFilters(true);
              }}
              onApply={(result) => {
                if (result.kind !== "creators") return;
                setSearch(result.query);
              }}
              onSelect={(result, id) => {
                if (result.kind !== "creators") return;
                setSearch(result.query, id);
                router.push(toHref(`/creator/${encodeURIComponent(id)}`));
              }}
            />
            <TextInput
              accessibilityLabel={t("studioDiscovery.text")}
              placeholder={t("studioDiscovery.text")}
              placeholderTextColor={theme.textSecondary}
              value={draft.text}
              maxLength={120}
              onChangeText={(text) => setDraft({ ...draft, text })}
              onSubmitEditing={apply}
              returnKeyType="search"
              style={{
                padding: 12,
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderRadius: 8,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: filters }}
              onPress={() => setFilters(!filters)}
              style={{ paddingVertical: 10 }}
            >
              <ThemedText>
                {t("studioDiscovery.category")} · {t("studioDiscovery.basedIn")} ·{" "}
                {t("studioDiscovery.serves")}
              </ThemedText>
            </Pressable>
            {filters && (
              <View style={{ gap: 12 }}>
                <ThemedText type="smallBold">{t("studioDiscovery.category")}</ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {([null, ...SERVICE_CATEGORIES] as const).map((category) => (
                    <Pressable
                      key={category ?? "all"}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: draft.category === (category ?? "") }}
                      onPress={() => setDraft({ ...draft, category: category ?? "" })}
                      style={{
                        padding: 10,
                        backgroundColor:
                          draft.category === (category ?? "")
                            ? theme.backgroundSelected
                            : theme.backgroundElement,
                      }}
                    >
                      <ThemedText>
                        {category
                          ? serviceCategoryLabel(category, t)
                          : t("studioDiscovery.anyCategory")}
                      </ThemedText>
                    </Pressable>
                  ))}
                </ScrollView>
                <PlaceFilter
                  label={t("studioDiscovery.basedIn")}
                  value={
                    draft.basedCountry || draft.basedCity
                      ? { countryCode: draft.basedCountry, city: draft.basedCity }
                      : null
                  }
                  onChange={(basedIn) =>
                    setDraft({
                      ...draft,
                      basedCountry: basedIn?.countryCode ?? "",
                      basedCity: basedIn?.city ?? "",
                    })
                  }
                />
                <PlaceFilter
                  label={t("studioDiscovery.serves")}
                  value={
                    draft.servesCountry || draft.servesCity
                      ? { countryCode: draft.servesCountry, city: draft.servesCity }
                      : null
                  }
                  onChange={(serves) =>
                    setDraft({
                      ...draft,
                      servesCountry: serves?.countryCode ?? "",
                      servesCity: serves?.city ?? "",
                    })
                  }
                />
                <ThemedText>{t("studioDiscovery.remoteOnly")}</ThemedText>
                <Switch
                  accessibilityLabel={t("studioDiscovery.remoteOnly")}
                  value={draft.remote === "1"}
                  onValueChange={(remoteOnly) =>
                    setDraft({ ...draft, remote: remoteOnly ? "1" : "" })
                  }
                  trackColor={{ false: theme.border, true: theme.brand }}
                  thumbColor={theme.text}
                />
                <ThemedText>{t("studioDiscovery.availableOnly")}</ThemedText>
                <Switch
                  accessibilityLabel={t("studioDiscovery.availableOnly")}
                  value={draft.available === "1"}
                  onValueChange={(availableForWork) =>
                    setDraft({ ...draft, available: availableForWork ? "1" : "" })
                  }
                  trackColor={{ false: theme.border, true: theme.brand }}
                  thumbColor={theme.text}
                />
              </View>
            )}
            {(!parsed.success || initial.invalid) && (
              <ThemedText accessibilityRole="alert">{t("studioDiscovery.invalid")}</ThemedText>
            )}
            {dirty && <ThemedText>{t("studioDiscovery.applyHint")}</ThemedText>}
            <Action
              label={t("studioDiscovery.search")}
              onPress={apply}
              disabled={!active || !parsed.success || initial.invalid}
            />
            <Action
              label={t("studioDiscovery.reset")}
              onPress={() => {
                setSearch(emptyStudioQuery);
              }}
              disabled={!active}
            />
            {!validLink && (
              <ThemedText accessibilityRole="alert">{t("studioDiscovery.invalidLink")}</ThemedText>
            )}
            {validLink && initial.selected && !state.loading && !state.error && state.page && (
              <View style={{ gap: 8 }}>
                <ThemedText type="smallBold">{t("studioDiscovery.selectedStudio")}</ThemedText>
                {state.page.selected ? (
                  <>
                    {!state.page.selected.matched && (
                      <ThemedText>{t("studioDiscovery.outsideFilters")}</ThemedText>
                    )}
                    <StudioCard studio={state.page.selected} />
                  </>
                ) : (
                  <ThemedText>{t("studioDiscovery.selectionUnavailable")}</ThemedText>
                )}
                <Action
                  label={t("studioDiscovery.clearSelection")}
                  onPress={() => setSearch(query)}
                  disabled={!active}
                />
              </View>
            )}
            {state.page && !state.error && (
              <ThemedText>
                {t("studioDiscovery.count").replace("{count}", String(state.page.matchedCount))}
              </ThemedText>
            )}
          </View>
        }
        ListEmptyComponent={
          validLink && !state.loading && !state.error ? (
            <ThemedText>{t("studioDiscovery.empty")}</ThemedText>
          ) : null
        }
        ListFooterComponent={
          <View style={{ gap: 12, paddingBottom: 24 }}>
            {state.loading && (
              <ActivityIndicator accessibilityLabel={t("studioDiscovery.loading")} />
            )}
            {state.error && (
              <>
                <ThemedText accessibilityRole="alert">{state.error}</ThemedText>
                <Action
                  label={t("studioDiscovery.retry")}
                  onPress={state.retry}
                  disabled={state.loading}
                />
              </>
            )}
            {state.hasMore && !state.error && (
              <Action
                label={t("studioDiscovery.more")}
                onPress={state.loadMore}
                disabled={state.loading}
              />
            )}
            {state.page?.requiresLogin && auth.status !== "authenticated" && (
              <>
                <ThemedText>{t("studioDiscovery.guestLimit")}</ThemedText>
                <Action label={t("studioDiscovery.login")} onPress={() => gate.requireAuth()} />
              </>
            )}
          </View>
        }
      />
    </View>
  );
}
