import { useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuth } from "@/auth";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { useCrewAssets } from "./use-crew-assets";
import type { CrewAsset, AssetQuery } from "./api";

type Props = {
  crewId: string;
  /** Already in the message draft; the backend permits ten attachments total. */
  excludedIds: string[];
  remaining: number;
  onSelect: (assets: CrewAsset[]) => void;
  onClose: () => void;
};
export function CrewAssetPicker(props: Props) {
  const auth = useAuth(),
    active = useScreenActive();
  if (!active || auth.status !== "authenticated") return null;
  return (
    <Picker
      key={JSON.stringify([props.crewId, auth.generation])}
      {...props}
      owner={String(auth.generation)}
    />
  );
}
function Picker({
  crewId,
  owner,
  excludedIds,
  remaining,
  onSelect,
  onClose,
}: Props & { owner: string }) {
  const t = useTranslations(),
    theme = useTheme();
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [source, setSource] = useState<AssetQuery["source"]>("all");
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CrewAsset[]>([]),
    [submitted, setSubmitted] = useState(false);
  const submittedRef = useRef(false);
  const listing = useCrewAssets(owner, crewId, {
    source,
    parentId: source === "all" ? folders.at(-1)?.id : undefined,
    query: query || undefined,
  });
  const limit = Number.isFinite(remaining) ? Math.max(0, Math.min(10, Math.floor(remaining))) : 0;
  if (listing.accessDenied && selected.length) setSelected([]);
  const eligible = listing.accessDenied
    ? []
    : selected.filter((asset) => !excludedIds.includes(asset.id));
  const attachDisabled =
    submitted ||
    !eligible.length ||
    eligible.length > limit ||
    !!listing.error ||
    listing.loading ||
    listing.accessDenied;
  const toggle = (asset: CrewAsset) => {
    if (
      submittedRef.current ||
      asset.kind !== "file" ||
      !asset.media ||
      excludedIds.includes(asset.id)
    )
      return;
    setSelected((previous) => {
      const current = previous.filter((item) => !excludedIds.includes(item.id));
      return current.some((item) => item.id === asset.id)
        ? current.filter((item) => item.id !== asset.id)
        : current.length < limit
          ? [...current, asset]
          : current;
    });
  };
  const clearSearch = () => {
    setSearch("");
    setQuery("");
  };
  return (
    <View style={{ flex: 1, padding: 12, gap: 12, backgroundColor: theme.background }}>
      <ThemedText type="smallBold">{t("crewAssets.choose")}</ThemedText>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {(["all", "recent", "favorites"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: source === value }}
            disabled={submitted}
            onPress={() => {
              setSource(value);
              setFolders([]);
              clearSearch();
            }}
            style={{
              padding: 8,
              backgroundColor:
                source === value ? theme.backgroundSelected : theme.backgroundElement,
            }}
          >
            <ThemedText>{t(`crewAssets.source.${value}`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      {!!folders.length && (
        <View>
          <ThemedText>{folders.map((folder) => folder.name).join(" / ")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={submitted}
            onPress={() => {
              setFolders((current) => current.slice(0, -1));
              clearSearch();
            }}
          >
            <ThemedText>{t("crewAssets.back")}</ThemedText>
          </Pressable>
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          accessibilityLabel={t("crewAssets.search")}
          placeholder={t("crewAssets.search")}
          placeholderTextColor={theme.text}
          value={search}
          maxLength={256}
          editable={!submitted}
          onChangeText={setSearch}
          onSubmitEditing={() => setQuery(search.trim())}
          style={{
            flex: 1,
            color: theme.text,
            padding: 8,
            backgroundColor: theme.backgroundElement,
          }}
        />
        <Pressable
          accessibilityRole="button"
          disabled={submitted}
          onPress={() => setQuery(search.trim())}
        >
          <ThemedText>{t("crewAssets.searchAction")}</ThemedText>
        </Pressable>
      </View>
      <ThemedText>
        {t("crewAssets.selected")} {eligible.length} / {limit}
      </ThemedText>
      {!!eligible.length && (
        <View>
          <ScrollView horizontal>
            {eligible.map((asset) => (
              <Pressable
                key={asset.id}
                accessibilityRole="button"
                accessibilityLabel={`${t("crewAssets.remove")} ${asset.name}`}
                disabled={submitted}
                onPress={() =>
                  setSelected((current) => current.filter((item) => item.id !== asset.id))
                }
                style={{ padding: 8 }}
              >
                <ThemedText>{asset.name} ×</ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      <FlatList
        data={listing.items}
        keyExtractor={(item) => item.id}
        onEndReached={listing.loadMore}
        onRefresh={listing.refresh}
        refreshing={listing.loading}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const checked = eligible.some((asset) => asset.id === item.id);
          const disabled =
            submitted ||
            (item.kind === "file" &&
              (!item.media ||
                excludedIds.includes(item.id) ||
                (!checked && eligible.length >= limit)));
          return (
            <Pressable
              accessibilityRole={item.kind === "folder" ? "button" : "checkbox"}
              accessibilityState={{ checked: item.kind === "file" ? checked : undefined, disabled }}
              accessibilityLabel={item.name}
              disabled={disabled}
              onPress={() => {
                if (item.kind === "folder") {
                  setSource("all");
                  setFolders((current) => [...current, { id: item.id, name: item.name }]);
                  clearSearch();
                } else toggle(item);
              }}
              style={{
                padding: 12,
                marginBottom: 8,
                borderRadius: 8,
                backgroundColor: checked ? theme.backgroundSelected : theme.backgroundElement,
              }}
            >
              <ThemedText>{item.name}</ThemedText>
              <ThemedText type="small">
                {t(item.kind === "folder" ? "crewAssets.folder" : "crewAssets.file")}
                {item.media ? ` · ${item.media.contentType}` : ""}
              </ThemedText>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !listing.loading && !listing.error ? (
            <ThemedText>{t("crewAssets.empty")}</ThemedText>
          ) : null
        }
        ListFooterComponent={
          <View>
            {listing.loading && <ActivityIndicator />}
            {listing.error && (
              <>
                <ThemedText accessibilityRole="alert">{listing.error}</ThemedText>
                <Pressable accessibilityRole="button" onPress={listing.retry}>
                  <ThemedText>{t("inbox.retry")}</ThemedText>
                </Pressable>
              </>
            )}
            {listing.hasMore && !listing.error && (
              <Pressable
                accessibilityRole="button"
                disabled={listing.loading}
                onPress={listing.loadMore}
              >
                <ThemedText>{t("crewAssets.more")}</ThemedText>
              </Pressable>
            )}
          </View>
        }
      />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          disabled={attachDisabled}
          onPress={() => {
            if (
              submittedRef.current ||
              listing.loading ||
              !!listing.error ||
              listing.accessDenied ||
              String(getAuthGeneration()) !== owner ||
              !eligible.length ||
              eligible.length > limit
            )
              return;
            submittedRef.current = true;
            setSubmitted(true);
            onSelect(eligible);
          }}
          style={{ padding: 12, opacity: attachDisabled ? 0.5 : 1 }}
        >
          <ThemedText>{t("crewAssets.attach")}</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={submitted}
          onPress={onClose}
          style={{ padding: 12 }}
        >
          <ThemedText>{t("myServices.cancel")}</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}
