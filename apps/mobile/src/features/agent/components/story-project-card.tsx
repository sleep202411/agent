import IconClock from "@tabler/icons-react-native/icons/IconClock";
import IconMovie from "@tabler/icons-react-native/icons/IconMovie";
import IconSparkles from "@tabler/icons-react-native/icons/IconSparkles";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { StoryProjectSummary } from "@/features/agent/api/studio-projects-api";
import { useTranslations } from "@/i18n";

function coverPreviewUrl(project: StoryProjectSummary): string | null {
  const cover = project.cover;
  if (
    cover?.kind === "image" &&
    cover.status === "ready" &&
    cover.moderationStatus !== "blocked" &&
    typeof cover.previewUrl === "string" &&
    cover.previewUrl.trim()
  ) {
    return cover.previewUrl.trim();
  }
  return null;
}

function formatUpdatedAt(input: string | undefined, unknownLabel: string): string {
  if (!input) return unknownLabel;
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return unknownLabel;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function MetricChip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <View style={styles.chip}>
      {icon}
      <Text style={styles.chipLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.chipValue}>{value}</Text>
    </View>
  );
}

export function StoryProjectCard({
  project,
  onPress,
}: {
  project: StoryProjectSummary;
  onPress: () => void;
}) {
  const t = useTranslations();
  const coverUrl = coverPreviewUrl(project);
  const clipCount = project.production?.clipCount ?? 0;
  const currentVideoCount = project.production?.currentVideoCount ?? 0;
  const summary = project.summary?.trim() || t("agent.projects.noSummary");
  const updated = formatUpdatedAt(project.updatedAt, t("agent.projects.updatedUnknown"));

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.poster}>
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={styles.posterPlaceholder}>
            <View style={styles.posterGradient} />
            <IconMovie color="rgba(255,255,255,0.16)" size={36} strokeWidth={1.4} />
          </View>
        )}

        <View style={styles.draftBadge}>
          <Text style={styles.draftBadgeText}>{t("agent.projectStatusDraft")}</Text>
        </View>

        <View style={styles.metricsRow}>
          <MetricChip
            icon={<IconMovie color="rgba(255,255,255,0.64)" size={12} strokeWidth={1.8} />}
            label={t("agent.metrics.clips")}
            value={String(clipCount)}
          />
          <MetricChip
            icon={<IconSparkles color="rgba(255,255,255,0.64)" size={12} strokeWidth={1.8} />}
            label={t("agent.metrics.videos")}
            value={`${currentVideoCount}/${clipCount}`}
          />
        </View>
      </View>

      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>
          {project.title}
        </Text>
        <Text style={styles.summary} numberOfLines={2}>
          {summary}
        </Text>
        <View style={styles.footer}>
          <IconClock color="rgba(255,255,255,0.4)" size={12} strokeWidth={2} />
          <Text style={styles.updatedText}>{updated}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.32,
    shadowRadius: 18,
    elevation: 8,
  },
  pressed: {
    opacity: 0.92,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  poster: {
    aspectRatio: 16 / 9,
    backgroundColor: "#171819",
    overflow: "hidden",
  },
  posterPlaceholder: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  posterGradient: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  draftBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    alignItems: "center",
    borderRadius: 999,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  draftBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: "rgba(255,255,255,0.7)",
    textTransform: "uppercase",
  },
  metricsRow: {
    position: "absolute",
    right: 10,
    bottom: 10,
    left: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(0,0,0,0.52)",
  },
  chipLabel: {
    flexShrink: 1,
    fontSize: 9,
    fontWeight: "600",
    color: "rgba(255,255,255,0.64)",
  },
  chipValue: {
    fontSize: 9,
    fontWeight: "600",
    color: "rgba(255,255,255,0.88)",
    fontVariant: ["tabular-nums"],
  },
  copy: {
    gap: 4,
    padding: 14,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.15,
    color: "#FFFFFF",
  },
  summary: {
    minHeight: 34,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "500",
    color: "rgba(255,255,255,0.56)",
  },
  footer: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  updatedText: {
    fontSize: 11,
    fontWeight: "500",
    color: "rgba(255,255,255,0.4)",
  },
});
