import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, ScreenHeader, Skeleton, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getCrewFeed } from "@/data/browse-service";
import type { CrewStatus, CrewSummary } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
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
        <View style={styles.list}>
          {[0, 1].map((item) => (
            <View key={item} style={styles.skeletonCard}>
              <Skeleton height={150} radius={8} />
              <Skeleton width="60%" height={16} />
              <Skeleton width="100%" height={28} />
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
        <View style={styles.list}>
          {crews.map((crew) => (
            <CrewCard key={crew.id} crew={crew} />
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
  const theme = useTheme();
  const t = useTranslations();
  const tag = crewStatusTag(crew.status);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(toHref(`/crew/${crew.id}`))}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.coverWrap}>
          <PosterImage
            uri={crew.coverUrl}
            label={crew.name}
            radius={0}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.coverScrim} />
          <View style={styles.coverTop}>
            <Tag label={t(tag.labelKey)} tone={tag.tone} />
            {crew.status === "recruiting" ? (
              <View style={[styles.rolesPill, { backgroundColor: theme.brand }]}>
                <ThemedText type="code" style={styles.rolesPillText}>
                  {crew.openRoles} {t("crews.rolesOpen")}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.cardBody}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {crew.name}
          </ThemedText>
          {crew.tagline ? (
            <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
              {crew.tagline}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {crew.summary}
          </ThemedText>
          <View style={styles.tagRow}>
            {crew.roleTags.slice(0, 3).map((role) => (
              <Tag key={role} label={role} />
            ))}
          </View>
          <View style={styles.footer}>
            {crew.location ? (
              <View style={styles.metaItem}>
                <SymbolView
                  name={{ ios: "mappin", android: "place", web: "place" }}
                  size={12}
                  tintColor={theme.textSecondary}
                />
                <ThemedText type="code" themeColor="textSecondary">
                  {crew.location}
                </ThemedText>
              </View>
            ) : null}
            {crew.memberCount ? (
              <View style={styles.metaItem}>
                <SymbolView
                  name={{ ios: "person.2", android: "group", web: "group" }}
                  size={12}
                  tintColor={theme.textSecondary}
                />
                <ThemedText type="code" themeColor="textSecondary">
                  {crew.memberCount} {t("crews.members")}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.three,
  },
  skeletonCard: {
    gap: Spacing.two,
  },
  card: {
    borderRadius: 8,
    overflow: "hidden",
  },
  coverWrap: {
    height: 150,
    justifyContent: "flex-start",
  },
  coverScrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(7,8,12,0.28)",
  },
  coverTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.three,
  },
  rolesPill: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  rolesPillText: {
    color: "#FFFFFF",
    fontSize: 11,
  },
  cardBody: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
    marginTop: Spacing.half,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.four,
    marginTop: Spacing.half,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pressed: {
    opacity: 0.82,
  },
});
