import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuthGate } from "@/auth";
import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, ScreenHeader, Skeleton, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getCreators } from "@/data/browse-service";
import type { CreatorSummary } from "@/data/types";
import { dicebearAvatarUrl } from "@/lib/avatar";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

export default function CreatorsScreen() {
  const t = useTranslations();
  const { isAuthenticated, openLogin } = useAuthGate();
  const [creators, setCreators] = useState<CreatorSummary[]>([]);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const browseVersion = useBrowseVersion();
  const hasDataRef = useRef(false);

  useEffect(() => {
    // Public directory (our Nest endpoint reads client_user directly), so this
    // loads for guests too; re-fetch on sign-in to lift the 50-row guest cap.
    let alive = true;
    async function load() {
      setLoading(hasDataRef.current === false);
      setError(undefined);
      try {
        const page = await getCreators(50);
        if (alive) {
          hasDataRef.current = true;
          setCreators(page.creators);
          setRequiresLogin(page.requiresLogin);
        }
      } catch (loadError) {
        if (alive && !hasDataRef.current) {
          setError(
            loadError instanceof Error ? loadError.message : t("creators.loadErrorFallback")
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [isAuthenticated, browseVersion, t]);

  return (
    <TabScreen gap={Spacing.five}>
      <ScreenHeader title={t("creators.title")} />

      {loading ? (
        <View style={styles.grid}>
          {[0, 1].map((rowIndex) => (
            <View key={rowIndex} style={styles.gridRow}>
              {[0, 1].map((col) => (
                <View key={col} style={styles.cardItem}>
                  <ThemedView type="backgroundElement" style={styles.card}>
                    <Skeleton width={72} height={72} radius={36} />
                    <Skeleton width="60%" height={14} />
                    <Skeleton width="42%" height={20} radius={6} />
                  </ThemedView>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : error ? (
        <EmptyState
          title={t("creators.loadErrorTitle")}
          detail={error}
          symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
        />
      ) : creators.length ? (
        <>
          <View style={styles.grid}>
            {chunkPairs(creators).map((row, rowIndex) => (
              <View key={rowIndex} style={styles.gridRow}>
                {row.map((creator) => (
                  <CreatorCard key={creator.id} creator={creator} />
                ))}
                {row.length === 1 ? <View style={styles.cardItem} /> : null}
              </View>
            ))}
          </View>
          {requiresLogin ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openLogin()}
              style={({ pressed }) => [styles.seeMore, pressed && styles.pressed]}
            >
              <ThemedText type="smallBold">{t("creators.seeMore")}</ThemedText>
            </Pressable>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={t("creators.emptyTitle")}
          detail={t("creators.emptyDetail")}
          symbol={{ ios: "person.crop.circle", android: "person", web: "person" }}
        />
      )}
    </TabScreen>
  );
}

function CreatorCard({ creator }: { creator: CreatorSummary }) {
  const t = useTranslations();
  const theme = useTheme();
  // Uploaded avatar first; else a deterministic DiceBear face by id.
  const avatarUrl = creator.avatarUrl ?? dicebearAvatarUrl(`creator:${creator.id}`);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(toHref(`/creator/${creator.id}`))}
      style={styles.cardItem}
    >
      {({ pressed }) => (
        <ThemedView type="backgroundElement" style={[styles.card, pressed && styles.pressed]}>
          <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
            <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          </View>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
            {creator.name}
          </ThemedText>
          <View style={styles.tags}>
            {creator.openToWork ? (
              <Tag label={t("creatorDetail.openToWork")} tone="success" />
            ) : creator.primaryLevel ? (
              <Tag label={creator.primaryLevel} tone="warning" />
            ) : null}
          </View>
        </ThemedView>
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
    alignItems: "center",
    borderRadius: 12,
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.four,
  },
  avatar: {
    alignItems: "center",
    borderRadius: 36,
    height: 72,
    justifyContent: "center",
    overflow: "hidden",
    width: 72,
  },
  name: {
    maxWidth: "100%",
    textAlign: "center",
  },
  tags: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
    justifyContent: "center",
    minHeight: 22,
  },
  pressed: {
    opacity: 0.82,
  },
  seeMore: {
    alignSelf: "center",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
  },
});
