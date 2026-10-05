import { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { CanvasLibraryAsset } from "../lib/story-canvas-overview";

/** Same generated/uploaded classification and name/prompt search as Web's library. */
export function StoryCanvasMediaLibrary({
  assets,
  visible,
  canEdit,
  onSaveCandidate,
  onPreviewPanorama,
  onPreview,
}: {
  assets: CanvasLibraryAsset[];
  visible: boolean;
  canEdit: boolean;
  onSaveCandidate: (mediaAssetId: string) => void;
  onPreview?: (asset: CanvasLibraryAsset) => void;
  onPreviewPanorama?: (asset: CanvasLibraryAsset) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [source, setSource] = useState<"all" | "generated" | "uploaded">("all");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return assets
      .filter(
        (asset) =>
          (source === "all" ||
            (asset.source === "generated" ? "generated" : "uploaded") === source) &&
          (!term ||
            asset.name?.toLowerCase().includes(term) ||
            asset.prompt?.toLowerCase().includes(term))
      )
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [assets, query, source]);
  if (!visible) return null;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {(["all", "generated", "uploaded"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: source === value }}
            onPress={() => setSource(value)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText type="small" style={{ color: source === value ? theme.brand : theme.text }}>
              {t(`storyCanvas.library.${value}`)}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("storyCanvas.library.search")}
        accessibilityLabel={t("storyCanvas.library.search")}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        style={{
          minHeight: 44,
          padding: 12,
          borderRadius: 8,
          backgroundColor: theme.backgroundElement,
          color: theme.text,
          fontSize: 14,
        }}
      />
      {!rows.length && (
        <ThemedText type="small" themeColor="textSecondary">
          {t(assets.length ? "storyCanvas.library.noMatches" : "storyCanvas.empty")}
        </ThemedText>
      )}
      {rows.map((asset) => (
        <View
          key={asset.id}
          style={{
            padding: 12,
            gap: 8,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <ThemedText type="smallBold">{asset.name || t(`storyCanvas.${asset.kind}`)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t(`storyCanvas.${asset.kind}`)} ·{" "}
            {t(`storyCanvas.library.${asset.source === "generated" ? "generated" : "uploaded"}`)}
          </ThemedText>
          {asset.prompt ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
              {asset.prompt}
            </ThemedText>
          ) : null}
          {asset.panorama && onPreviewPanorama && (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPreviewPanorama(asset)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <ThemedText type="small">{t("storyCanvas.panorama.open")}</ThemedText>
            </Pressable>
          )}
          {!asset.panorama && onPreview && (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPreview(asset)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <ThemedText type="small">{t("storyCandidates.preview")}</ThemedText>
            </Pressable>
          )}
          {canEdit && asset.mediaAssetId && (
            <Pressable
              accessibilityRole="button"
              onPress={() => onSaveCandidate(asset.mediaAssetId!)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <ThemedText type="small">{t("storyCanvas.saveCandidate")}</ThemedText>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}
