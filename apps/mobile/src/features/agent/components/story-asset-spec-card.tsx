import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import type { StoryAssetSpec } from "@/features/agent/api/story-production-api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

/** Match H5 media-first card aspect lanes. */
const MEDIA_ASPECT = {
  character: 3 / 4,
  location: 16 / 9,
  prop: 1,
} as const;

function mediaUrl(asset: StoryAssetSpec): string | undefined {
  return (
    asset.selectedMediaVersion?.thumbnailUrl?.trim() ||
    asset.selectedMediaVersion?.previewUrl?.trim() ||
    asset.mediaVersions[0]?.thumbnailUrl?.trim() ||
    asset.mediaVersions[0]?.previewUrl?.trim() ||
    undefined
  );
}

/** Browse-only asset card — H5 `StoryAssetSpecCard` media-first layout. */
export function StoryAssetSpecCard({
  asset,
  onPressDetails,
}: {
  asset: StoryAssetSpec;
  onPressDetails?: (asset: StoryAssetSpec) => void;
}) {
  const t = useTranslations();
  const theme = useTheme();
  const uri = mediaUrl(asset);
  const aspectRatio = MEDIA_ASPECT[asset.kind];
  const stale = asset.status === "stale";

  return (
    <View style={styles.card}>
      <View style={[styles.mediaFrame, { aspectRatio, backgroundColor: theme.backgroundSelected }]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={styles.mediaPlaceholder}>
            <ThemedText type="code" themeColor="textSecondary">
              —
            </ThemedText>
          </View>
        )}
        {stale ? (
          <View style={styles.staleBadge}>
            <ThemedText type="code" style={styles.staleBadgeLabel}>
              {t("agent.assets.status.stale")}
            </ThemedText>
          </View>
        ) : null}
        {onPressDetails ? (
          <View style={[styles.overlay, !uri && styles.overlayCentered]} pointerEvents="box-none">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("agent.assets.details")}
              onPress={() => onPressDetails(asset)}
            >
              <View style={styles.detailsChip}>
                <ThemedText type="code" style={styles.detailsChipLabel}>
                  {t("agent.assets.details")}
                </ThemedText>
              </View>
            </Pressable>
          </View>
        ) : null}
      </View>
      <View style={styles.copy}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
          {asset.name}
        </ThemedText>
        {asset.description ? (
          <ThemedText numberOfLines={2} style={styles.description}>
            {asset.description}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.045)",
    borderRadius: 16,
    minWidth: 0,
    padding: Spacing.three,
  },
  mediaFrame: {
    borderRadius: 12,
    overflow: "hidden",
    width: "100%",
  },
  mediaPlaceholder: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  overlay: {
    alignItems: "flex-end",
    bottom: 10,
    gap: 6,
    position: "absolute",
    right: 10,
  },
  overlayCentered: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    right: 0,
    top: 0,
  },
  detailsChip: {
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  detailsChipLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    fontWeight: "500",
  },
  staleBadge: {
    backgroundColor: "rgba(251, 191, 36, 0.16)",
    borderRadius: 6,
    left: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    position: "absolute",
    top: Spacing.two,
  },
  staleBadgeLabel: {
    color: "rgba(253, 230, 138, 0.92)",
    fontSize: 10,
    fontWeight: "600",
  },
  copy: {
    gap: 4,
    marginTop: Spacing.three,
  },
  name: {
    color: "rgba(255,255,255,0.94)",
    fontSize: 14,
    fontWeight: "600",
  },
  description: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 12,
    lineHeight: 18,
  },
});
