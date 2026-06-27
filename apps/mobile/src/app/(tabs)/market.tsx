import { Image } from "expo-image";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  ChipRail,
  EmptyState,
  PosterImage,
  ScreenHeader,
  SectionHeader,
  Skeleton,
  Tag,
} from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useBrowseVersion } from "@/data/browse-refresh";
import { getMarketFeed, type MarketFeed } from "@/data/market-service";
import type { CreatorServiceSummary, CreatorSummary, CrewStatus, CrewSummary } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { type MessageKey, useLocale, useTranslations } from "@/i18n";
import { formatServicePrice, serviceCategoryLabel } from "@/lib/creator-service-format";
import { toHref } from "@/lib/navigation";

const filterKeys = [
  "market.filterAll",
  "market.filterCreators",
  "market.filterServices",
  "market.filterCrews",
] as const satisfies MessageKey[];

function openCreator(id: string) {
  router.push(toHref(`/creator/${id}`));
}

function openService(id: string) {
  router.push(toHref(`/service/${id}`));
}

function openCrew(id: string) {
  router.push(toHref(`/crew/${id}`));
}

function crewStatusTag(status: CrewStatus): {
  labelKey: MessageKey;
  tone: "success" | "info" | "neutral";
} {
  if (status === "recruiting") return { labelKey: "crews.statusRecruiting", tone: "success" };
  if (status === "in-production") return { labelKey: "crews.statusInProduction", tone: "info" };
  return { labelKey: "crews.statusClosed", tone: "neutral" };
}

export default function MarketScreen() {
  const t = useTranslations();
  const [feed, setFeed] = useState<MarketFeed>({ creators: [], services: [], crews: [] });
  const [activeFilter, setActiveFilter] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const browseVersion = useBrowseVersion();
  const hasDataRef = useRef(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(hasDataRef.current === false);
      setError(undefined);
      try {
        const data = await getMarketFeed({ creatorLimit: 24, serviceLimit: 24 });
        if (!alive) return;
        hasDataRef.current = true;
        setFeed(data);
      } catch (loadError) {
        if (!alive || hasDataRef.current) return;
        setError(loadError instanceof Error ? loadError.message : t("market.loadErrorFallback"));
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [t, browseVersion]);

  const chips = useMemo(() => filterKeys.map((key) => t(key)), [t]);
  const showCreators = activeFilter === 0 || activeFilter === 1;
  const showServices = activeFilter === 0 || activeFilter === 2;
  const showCrews = activeFilter === 0 || activeFilter === 3;
  const visibleCount =
    (showCreators ? feed.creators.length : 0) +
    (showServices ? feed.services.length : 0) +
    (showCrews ? feed.crews.length : 0);

  return (
    <TabScreen gap={Spacing.five}>
      <ScreenHeader title={t("market.title")} />

      <ChipRail items={chips} activeIndex={activeFilter} onChange={setActiveFilter} />

      {loading ? (
        <MarketSkeleton />
      ) : error ? (
        <EmptyState
          title={t("market.loadErrorTitle")}
          detail={error}
          symbol={{ ios: "storefront", android: "storefront", web: "storefront" }}
        />
      ) : visibleCount ? (
        <>
          {showCreators && feed.creators.length ? (
            <View style={styles.section}>
              <SectionHeader
                title={t("market.creatorsTitle")}
                trailing={`${feed.creators.length}`}
              />
              <View style={styles.list}>
                {feed.creators.map((creator) => (
                  <CreatorMarketCard key={creator.id} creator={creator} />
                ))}
              </View>
            </View>
          ) : null}

          {showServices && feed.services.length ? (
            <View style={styles.section}>
              <SectionHeader
                title={t("market.servicesTitle")}
                trailing={`${feed.services.length}`}
              />
              <View style={styles.list}>
                {feed.services.map((service) => (
                  <ServiceMarketCard key={service.id} service={service} />
                ))}
              </View>
            </View>
          ) : null}

          {showCrews && feed.crews.length ? (
            <View style={styles.section}>
              <SectionHeader title={t("market.crewsTitle")} trailing={`${feed.crews.length}`} />
              <View style={styles.list}>
                {feed.crews.map((crew) => (
                  <CrewMarketCard key={crew.id} crew={crew} />
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : (
        <EmptyState
          title={t("market.emptyTitle")}
          detail={t("market.emptyDetail")}
          symbol={{ ios: "storefront", android: "storefront", web: "storefront" }}
        />
      )}
    </TabScreen>
  );
}

function CreatorMarketCard({ creator }: { creator: CreatorSummary }) {
  const theme = useTheme();
  const initial = creator.name.trim().slice(0, 1).toUpperCase();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openCreator(creator.id)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="backgroundElement" style={styles.creatorCard}>
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
        <View style={styles.cardCopy}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {creator.name}
          </ThemedText>
          {creator.primaryLevel ? (
            <View style={styles.tagRow}>
              <Tag label={creator.primaryLevel} tone="warning" />
            </View>
          ) : null}
        </View>
        <Chevron />
      </ThemedView>
    </Pressable>
  );
}

function ServiceMarketCard({ service }: { service: CreatorServiceSummary }) {
  const t = useTranslations();
  const locale = useLocale();
  const theme = useTheme();
  const hasCover = Boolean(service.coverUrl);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openService(service.id)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView
        type="backgroundElement"
        style={[styles.serviceCard, !hasCover && styles.serviceCardNoCover]}
      >
        {hasCover ? (
          <PosterImage
            uri={service.coverUrl}
            label={service.title}
            radius={8}
            style={styles.serviceThumb}
          />
        ) : null}
        <View style={styles.cardCopy}>
          <View style={styles.tagRow}>
            <Tag label={serviceCategoryLabel(service.category, t)} />
            {service.packageCount ? (
              <Tag label={`${service.packageCount} ${t("creatorService.packagesShort")}`} />
            ) : null}
          </View>
          <ThemedText type="smallBold" numberOfLines={1}>
            {service.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {service.summary}
          </ThemedText>
          <View style={styles.metaRow}>
            <ThemedText type="code" style={{ color: theme.brand }}>
              {t("creatorService.fromPrice")} {formatServicePrice(service, locale)}
            </ThemedText>
            {service.startingDeliveryDays ? (
              <ThemedText type="code" themeColor="textSecondary">
                {service.startingDeliveryDays} {t("serviceDetail.days")}
              </ThemedText>
            ) : null}
          </View>
        </View>
      </ThemedView>
    </Pressable>
  );
}

function CrewMarketCard({ crew }: { crew: CrewSummary }) {
  const t = useTranslations();
  const theme = useTheme();
  const status = crewStatusTag(crew.status);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => openCrew(crew.id)}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="backgroundElement" style={styles.crewCard}>
        <PosterImage uri={crew.coverUrl} label={crew.name} radius={8} style={styles.crewCover} />
        <View style={styles.cardCopy}>
          <View style={styles.tagRow}>
            <Tag label={t(status.labelKey)} tone={status.tone} />
            {crew.openRoles ? (
              <Tag label={`${crew.openRoles} ${t("crews.rolesOpen")}`} tone="brand" />
            ) : null}
          </View>
          <ThemedText type="smallBold" numberOfLines={1}>
            {crew.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {crew.summary}
          </ThemedText>
          <View style={styles.metaRow}>
            {crew.roleTags[0] ? <Tag label={crew.roleTags[0]} /> : null}
            {crew.memberCount ? (
              <View style={styles.memberMeta}>
                <SymbolView
                  name={{ ios: "person.2", android: "group", web: "group" }}
                  size={12}
                  tintColor={theme.textSecondary}
                />
                <ThemedText type="code" themeColor="textSecondary">
                  {crew.memberCount}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>
      </ThemedView>
    </Pressable>
  );
}

function Chevron() {
  const theme = useTheme();
  return (
    <SymbolView
      name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
      size={14}
      tintColor={theme.textSecondary}
    />
  );
}

function MarketSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2].map((item) => (
        <ThemedView key={item} type="backgroundElement" style={styles.skeletonCard}>
          <Skeleton width={72} height={72} radius={8} />
          <View style={styles.cardCopy}>
            <Skeleton width="58%" height={16} />
            <Skeleton width="92%" height={14} />
            <Skeleton width="70%" height={14} />
          </View>
        </ThemedView>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.three,
  },
  list: {
    gap: Spacing.three,
  },
  creatorCard: {
    minHeight: 76,
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  serviceCard: {
    minHeight: 126,
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
  },
  serviceCardNoCover: {
    minHeight: 0,
  },
  serviceThumb: {
    width: 78,
    aspectRatio: 1,
  },
  crewCard: {
    minHeight: 126,
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.three,
  },
  crewCover: {
    width: 96,
    aspectRatio: 16 / 10,
  },
  cardCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  tagRow: {
    minHeight: 22,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  metaRow: {
    minHeight: 22,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
  },
  memberMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  skeletonCard: {
    minHeight: 98,
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.82,
  },
});
