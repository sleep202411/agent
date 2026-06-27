import { Image } from "expo-image";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuthGate, useLoginGateOnFocus } from "@/auth";
import { AuthRequired } from "@/components/auth-required";
import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, ScreenHeader, Skeleton, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getCreators } from "@/data/browse-service";
import type { CreatorSummary } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

export default function CreatorsScreen() {
  const t = useTranslations();
  const { isAuthenticated } = useAuthGate();
  // Guests get the global login sheet straight away — the list is login-only.
  useLoginGateOnFocus();
  const [creators, setCreators] = useState<CreatorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const browseVersion = useBrowseVersion();
  const hasDataRef = useRef(false);

  useEffect(() => {
    // The talent list endpoint requires a Java session; skip it for guests so
    // we show the sign-in prompt instead of a 302-empty "no creators" state.
    if (!isAuthenticated) {
      // Guests render the sign-in prompt below; reset so a fresh login refetches.
      hasDataRef.current = false;
      return;
    }
    let alive = true;
    async function load() {
      setLoading(hasDataRef.current === false);
      setError(undefined);
      try {
        const data = await getCreators(48);
        if (alive) {
          hasDataRef.current = true;
          setCreators(data);
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

      {!isAuthenticated ? (
        <AuthRequired
          title={t("creators.guestTitle")}
          body={t("creators.guestBody")}
          icon={{ ios: "person.2", android: "group", web: "group" }}
        />
      ) : loading ? (
        <View style={styles.list}>
          {[0, 1, 2, 3].map((item) => (
            <ThemedView key={item} type="backgroundElement" style={styles.card}>
              <Skeleton width={56} height={56} radius={28} />
              <View style={styles.copy}>
                <Skeleton width="56%" height={16} />
                <Skeleton width="34%" height={12} />
              </View>
            </ThemedView>
          ))}
        </View>
      ) : error ? (
        <EmptyState
          title={t("creators.loadErrorTitle")}
          detail={error}
          symbol={{ ios: "exclamationmark.triangle", android: "warning", web: "warning" }}
        />
      ) : creators.length ? (
        <View style={styles.list}>
          {creators.map((creator) => (
            <CreatorCard key={creator.id} creator={creator} />
          ))}
        </View>
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
  const initial = creator.name.trim().slice(0, 1).toUpperCase();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(toHref(`/creator/${creator.id}`))}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
          {creator.avatarUrl ? (
            <Image
              source={{ uri: creator.avatarUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <ThemedText type="smallBold" themeColor="textSecondary">
              {initial}
            </ThemedText>
          )}
        </View>
        <View style={styles.copy}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {creator.name}
          </ThemedText>
          <View style={styles.tags}>
            {creator.primaryLevel ? <Tag label={creator.primaryLevel} tone="warning" /> : null}
            {creator.openToWork ? (
              <Tag label={t("creatorDetail.openToWork")} tone="success" />
            ) : null}
          </View>
        </View>
        <SymbolView
          name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
          size={16}
          tintColor={theme.textSecondary}
        />
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Spacing.two,
  },
  card: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: Spacing.three,
    minHeight: 82,
    padding: Spacing.three,
  },
  avatar: {
    alignItems: "center",
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    overflow: "hidden",
    width: 56,
  },
  copy: {
    flex: 1,
    gap: Spacing.one,
    minWidth: 0,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
    minHeight: 22,
  },
  pressed: {
    opacity: 0.82,
  },
});
