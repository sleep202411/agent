import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import type { StoryAssetSpec } from "../api/story-production-api";

/** Three-view results are references, not selectable primary images. */
export function StoryAssetMediaVersions({
  asset,
  locked = false,
  onSelect,
  onSaveCandidate,
}: {
  asset: StoryAssetSpec;
  locked?: boolean;
  onSaveCandidate?: (mediaAssetId: string) => void;
  onSelect?: (id: string | null) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const ordered = [...asset.mediaVersions].sort((a, b) => b.versionNumber - a.versionNumber);
  const primary = ordered.filter((v) => v.purpose !== "turnaround");
  const turnaround = ordered.filter((v) => v.purpose === "turnaround");
  return (
    <View style={{ gap: 12 }}>
      {(
        [
          { key: "primary", versions: primary },
          ...(asset.kind === "character" || turnaround.length
            ? [{ key: "turnaround", versions: turnaround }]
            : []),
        ] as const
      ).map((group) => (
        <View key={group.key} style={{ gap: 8 }}>
          <ThemedText type="smallBold">
            {t(
              group.key === "primary" ? "assetEdit.primaryVersions" : "assetEdit.turnaroundVersions"
            )}
          </ThemedText>
          {!group.versions.length && (
            <ThemedText type="small">{t("assetEdit.noVersions")}</ThemedText>
          )}
          {group.key === "turnaround" && group.versions.length > 0 && (
            <ThemedText type="small">{t("assetEdit.latestTurnaround")}</ThemedText>
          )}
          {group.versions.map((version, index) => {
            const url = version.previewUrl || version.thumbnailUrl;
            const selected =
              group.key === "primary" ? asset.selectedMediaVersion?.id === version.id : index === 0;
            const label = `${selected ? "✓ " : ""}${t(onSelect && group.key === "primary" ? "assetEdit.select" : "assetEdit.version")} ${version.versionNumber}`;
            return (
              <View key={version.id} style={{ gap: 4 }}>
                {version.mediaKind === "image" && url && /^https:\/\//i.test(url) && (
                  <Image
                    source={{ uri: url }}
                    accessibilityLabel={label}
                    style={{ height: 140, width: "100%" }}
                    contentFit="contain"
                  />
                )}
                {onSaveCandidate &&
                  version.mediaStatus === "ready" &&
                  version.mediaAssetId &&
                  ["image", "video", "audio"].includes(version.mediaKind) && (
                    <Pressable
                      accessibilityRole="button"
                      disabled={locked}
                      onPress={() => onSaveCandidate(version.mediaAssetId)}
                      style={{ paddingVertical: 12, opacity: locked ? 0.5 : 1 }}
                    >
                      <ThemedText type="smallBold">{t("storyCandidates.save")}</ThemedText>
                    </Pressable>
                  )}
                {onSelect && group.key === "primary" ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={locked}
                    onPress={() => onSelect(version.id)}
                    style={{ paddingVertical: 12, opacity: locked ? 0.5 : 1 }}
                  >
                    <ThemedText type="smallBold" style={{ color: theme.brand }}>
                      {label}
                    </ThemedText>
                  </Pressable>
                ) : (
                  <ThemedText type="small">{label}</ThemedText>
                )}
              </View>
            );
          })}
        </View>
      ))}
      {onSelect && asset.selectedMediaVersion && (
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => onSelect(null)}
          style={{ paddingVertical: 12, opacity: locked ? 0.5 : 1 }}
        >
          <ThemedText type="smallBold" style={{ color: theme.brand }}>
            {t("assetEdit.clearSelection")}
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}
