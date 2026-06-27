import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { EmptyState, PosterImage, ScreenHeader, Skeleton, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getCrewFeed } from "@/data/browse-service";
import type { CrewStatus, CrewSummary } from "@/data/types";
import { type MessageKey, useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

export function crewStatusTag(status: CrewStatus): {
  labelKey: MessageKey;
  tone: "success" | "info" | "neutral";
} {
  if (status === "recruiting") return { labelKey: "crews.statusRecruiting", tone: "success" };
  if (status === "in-production") return { labelKey: "crews.statusInProduction", tone: "info" };
  return { labelKey: "crews.statusClosed", tone: "neutral" };
}

function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

export default function CrewsScreen() {
  const t = useTranslations();
  const [crews, setCrews] = useState<CrewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  // Bumped when a mutation elsewhere (e.g. blocking a crew) invalidates lists.
  const browseVersion = useBrowseVersion();
  const hasDataRef = useRef(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      // Skeleton only when there is nothing to show yet — refetches swap in place.
      setLoading(hasDataRef.current === false);
      setError(undefined);
      try {
        const data = await getCrewFeed();
        if (alive) {
          hasDataRef.current = true;
          setCrews(data);
        }
      } catch (loadError) {
        // A failed background refetch keeps the list we already have.
        if (alive && !hasDataRef.current) {
          setError(loadError instanceof Error ? loadError.message : t("crews.loadErrorFallback"));
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [t, browseVersion]);

  return (
    <TabScreen gap={Spacing.five}>
      <ScreenHeader title={t("crews.title")} />

      {loading ? (
        <View style={styles.grid}>
          {[0, 1].map((rowIndex) => (
            <View key={rowIndex} style={styles.gridRow}>
              {[0, 1].map((col) => (
                <View key={col} style={styles.cardItem}>
                  <View style={styles.card}>
                    <Skeleton height={100} radius={12} />
                    <Skeleton width="70%" height={14} />
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : error ? (
        <EmptyState
          title={t("crews.loadErrorTitle")}
          detail={error}
          symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
        />
      ) : crews.length ? (
        <View style={styles.grid}>
          {chunkPairs(crews).map((row, rowIndex) => (
            <View key={rowIndex} style={styles.gridRow}>
              {row.map((crew) => (
                <CrewCard key={crew.id} crew={crew} />
              ))}
              {row.length === 1 ? <View style={styles.cardItem} /> : null}
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          title={t("crews.emptyTitle")}
          detail={t("crews.emptyDetail")}
          symbol={{ ios: "person.2", android: "group", web: "group" }}
        />
      )}
    </TabScreen>
  );
}

function CrewCard({ crew }: { crew: CrewSummary }) {
  const t = useTranslations();
  const tag = crewStatusTag(crew.status);
  const metaLabel =
    crew.status === "recruiting" && crew.openRoles > 0
      ? `${crew.openRoles} ${t("crews.rolesOpen")}`
      : crew.memberCount
        ? `${crew.memberCount} ${t("crews.members")}`
        : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(toHref(`/crew/${crew.id}`))}
      style={styles.cardItem}
    >
      {({ pressed }) => (
        <View style={[styles.card, pressed && styles.pressed]}>
          <PosterImage uri={crew.coverUrl} label={crew.name} radius={12} style={styles.cover} />
          <ThemedText type="smallBold" numberOfLines={2}>
            {crew.name}
          </ThemedText>
          <View style={styles.metaRow}>
            <Tag label={t(tag.labelKey)} tone={tag.tone} />
            {metaLabel ? <Tag label={metaLabel} /> : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: Spacing.four,
  },
  gridRow: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  cardItem: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    gap: Spacing.one + 2,
  },
  cover: {
    aspectRatio: 16 / 9,
    width: "100%",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
    minHeight: 22,
  },
  pressed: {
    opacity: 0.82,
  },
});
