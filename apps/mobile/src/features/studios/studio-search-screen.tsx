import { useState } from "react";
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
import { Stack, useRouter } from "expo-router";
import { SERVICE_CATEGORIES } from "@repo/shared/creator-service";
import { REGIONS, regionLabel } from "@repo/shared/regions";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { serviceCategoryLabel } from "@/lib/creator-service-format";
import { toHref } from "@/lib/navigation";
import {
  emptyStudioQuery,
  parseStudioQuery,
  type StudioQuery,
  type StudioPage,
} from "./studio-search-api";
import { DiscoveryAssistantPanel } from "./discovery-assistant-panel";
import { useStudioSearch } from "./use-studio-search";

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
      <Action label={t("studioDiscovery.viewStudio")} onPress={open} />
    </View>
  );
}
export function StudioSearchScreen() {
  const router = useRouter();
  const auth = useAuth(),
    gate = useAuthGate(),
    active = useScreenActive(),
    t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [draft, setDraft] = useState<StudioQuery>(emptyStudioQuery),
    [query, setQuery] = useState<StudioQuery>(emptyStudioQuery),
    [filters, setFilters] = useState(false);
  const state = useStudioSearch(
    {
      generation: auth.generation,
      viewerId:
        auth.status === "authenticated" ? String(auth.user?.userId ?? auth.user?.id ?? "") : null,
    },
    query,
    locale,
    active && auth.status !== "hydrating"
  );
  const parsed = parseStudioQuery(draft),
    dirty = JSON.stringify(draft) !== JSON.stringify(query);
  const apply = () => {
    if (!parsed.success) return;
    setDraft(parsed.data);
    if (JSON.stringify(parsed.data) === JSON.stringify(query)) state.refresh();
    else setQuery(parsed.data);
    setFilters(false);
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
              valid={parsed.success}
              onReview={(result) => {
                setDraft(result.query);
                setFilters(true);
              }}
              onApply={(result) => {
                setDraft(result.query);
                setQuery(result.query);
                state.refresh();
                setFilters(false);
              }}
              onSelect={(result, id) => {
                setDraft(result.query);
                setQuery(result.query);
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
                      accessibilityState={{ selected: draft.category === category }}
                      onPress={() => setDraft({ ...draft, category })}
                      style={{
                        padding: 10,
                        backgroundColor:
                          draft.category === category
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
                  value={draft.basedIn}
                  onChange={(basedIn) => setDraft({ ...draft, basedIn })}
                />
                <PlaceFilter
                  label={t("studioDiscovery.serves")}
                  value={draft.serves}
                  onChange={(serves) => setDraft({ ...draft, serves })}
                />
                <ThemedText>{t("studioDiscovery.remoteOnly")}</ThemedText>
                <Switch
                  accessibilityLabel={t("studioDiscovery.remoteOnly")}
                  value={draft.remoteOnly}
                  onValueChange={(remoteOnly) => setDraft({ ...draft, remoteOnly })}
                  trackColor={{ false: theme.border, true: theme.brand }}
                  thumbColor={theme.text}
                />
                <ThemedText>{t("studioDiscovery.availableOnly")}</ThemedText>
                <Switch
                  accessibilityLabel={t("studioDiscovery.availableOnly")}
                  value={draft.availableForWork}
                  onValueChange={(availableForWork) => setDraft({ ...draft, availableForWork })}
                  trackColor={{ false: theme.border, true: theme.brand }}
                  thumbColor={theme.text}
                />
              </View>
            )}
            {!parsed.success && (
              <ThemedText accessibilityRole="alert">{t("studioDiscovery.invalid")}</ThemedText>
            )}
            {dirty && <ThemedText>{t("studioDiscovery.applyHint")}</ThemedText>}
            <Action
              label={t("studioDiscovery.search")}
              onPress={apply}
              disabled={!active || !parsed.success}
            />
            <Action
              label={t("studioDiscovery.reset")}
              onPress={() => {
                setDraft(emptyStudioQuery);
                setQuery(emptyStudioQuery);
                state.refresh();
                setFilters(false);
              }}
              disabled={!active}
            />
            {state.page && !state.error && (
              <ThemedText>
                {t("studioDiscovery.count").replace("{count}", String(state.page.matchedCount))}
              </ThemedText>
            )}
          </View>
        }
        ListEmptyComponent={
          !state.loading && !state.error ? (
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
