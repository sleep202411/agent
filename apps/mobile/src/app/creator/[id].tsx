import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IpGrid } from "@/components/ip-grid";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, SectionHeader, Tag } from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import {
  getCreatorById,
  getCreatorIps,
  getCreatorServices,
  getCrewsByUser,
} from "@/data/browse-service";
import type {
  CreatorServiceSummary,
  CreatorSummary,
  CrewStatus,
  CrewSummary,
  IpSummary,
} from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { type MessageKey, useLocale, useTranslations } from "@/i18n";
import { formatServicePrice, serviceCategoryLabel } from "@/lib/creator-service-format";
import { toHref } from "@/lib/navigation";

import { CreatorPersonalWorks } from "@/features/profile/creator-personal-works";
import { CreatorExperience } from "@/features/profile/creator-experience";
import { CreatorEducation } from "@/features/profile/creator-education";

export default function CreatorDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useTranslations();
  const locale = useLocale();
  const [creator, setCreator] = useState<CreatorSummary>();
  const [services, setServices] = useState<CreatorServiceSummary[]>([]);
  const [works, setWorks] = useState<IpSummary[]>([]);
  const [crews, setCrews] = useState<CrewSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      const [creatorResult, servicesResult, worksResult, crewsResult] = await Promise.allSettled([
        getCreatorById(id),
        getCreatorServices(12, { creatorId: id }),
        getCreatorIps(id),
        getCrewsByUser(id),
      ]);
      if (!alive) return;
      setCreator(creatorResult.status === "fulfilled" ? creatorResult.value : undefined);
      setServices(servicesResult.status === "fulfilled" ? servicesResult.value : []);
      setWorks(worksResult.status === "fulfilled" ? worksResult.value : []);
      setCrews(crewsResult.status === "fulfilled" ? crewsResult.value : []);
      setLoading(false);
    }
    void load();
    return () => {
      alive = false;
    };
  }, [id]);

  if (loading) {
    return (
      <ThemedView style={styles.fullCenter}>
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }

  if (!creator) {
    return (
      <ThemedView style={[styles.fullCenter, { padding: Spacing.four }]}>
        <EmptyState
          title={t("creatorDetail.notFoundTitle")}
          detail={t("creatorDetail.notFoundDetail")}
          symbol={{ ios: "person.crop.circle", android: "person", web: "person" }}
        />
      </ThemedView>
    );
  }

  const initial = creator.name.trim().slice(0, 1).toUpperCase();

  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          headerTitle: "",
          headerBackButtonDisplayMode: "minimal",
          headerTintColor: theme.text,
        }}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.seven }}
      >
        <View style={styles.hero}>
          {creator.bannerUrl ? (
            <Image
              source={{ uri: creator.bannerUrl }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundElement }]} />
          )}
          <View style={styles.heroScrim} />
          <View style={styles.heroCopy}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
              {creator.avatarUrl ? (
                <Image
                  source={{ uri: creator.avatarUrl }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
              ) : (
                <ThemedText type="title" themeColor="textSecondary">
                  {initial}
                </ThemedText>
              )}
            </View>
            <View style={styles.identity}>
              <ThemedText type="subtitle" style={styles.name} numberOfLines={1}>
                {creator.name}
              </ThemedText>
              <View style={styles.metaRow}>
                {creator.primaryLevel ? <Tag label={creator.primaryLevel} tone="warning" /> : null}
                {creator.openToWork ? (
                  <Tag label={t("creatorDetail.openToWork")} tone="success" />
                ) : null}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.section}>
            <SectionHeader title={t("creatorDetail.aboutTitle")} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.paragraph}>
              {creator.bio || t("creatorDetail.bioEmpty")}
            </ThemedText>
          </View>

          <CreatorEducation study={creator.study} />
          <CreatorExperience creatorId={creator.id} />
          <CreatorPersonalWorks creatorId={creator.id} />

          {creator.levels.length ? (
            <View style={styles.section}>
              <SectionHeader title={t("creatorDetail.credentialsTitle")} />
              <View style={styles.levelWrap}>
                {creator.levels.map((level) => (
                  <Tag key={level.id} label={level.name} tone="warning" />
                ))}
              </View>
            </View>
          ) : null}

          {works.length ? (
            <View style={styles.section}>
              <SectionHeader title={t("creatorDetail.worksTitle")} trailing={`${works.length}`} />
              <IpGrid ips={works} />
            </View>
          ) : null}

          {crews.length ? (
            <View style={styles.section}>
              <SectionHeader title={t("creatorDetail.crewsTitle")} trailing={`${crews.length}`} />
              <View style={styles.serviceList}>
                {crews.map((crew) => (
                  <CreatorCrewRow
                    key={crew.id}
                    crew={crew}
                    onPress={() => router.push(toHref(`/crew/${crew.id}`))}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionHeader
              title={t("creatorDetail.servicesTitle")}
              trailing={`${services.length}`}
            />
            {services.length ? (
              <View style={styles.serviceList}>
                {services.map((service) => (
                  <CreatorServiceRow
                    key={service.id}
                    service={service}
                    locale={locale}
                    onPress={() => router.push(toHref(`/service/${service.id}`))}
                  />
                ))}
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {t("creatorDetail.servicesEmpty")}
              </ThemedText>
            )}
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function CreatorServiceRow({
  service,
  locale,
  onPress,
}: {
  service: CreatorServiceSummary;
  locale: string;
  onPress: () => void;
}) {
  const t = useTranslations();
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <View style={[styles.serviceRow, { borderBottomColor: theme.border }]}>
        <PosterImage
          uri={service.coverUrl}
          label={service.title}
          radius={8}
          style={styles.serviceThumb}
        />
        <View style={styles.serviceCopy}>
          <View style={styles.metaRow}>
            <Tag label={serviceCategoryLabel(service.category, t)} />
          </View>
          <ThemedText type="smallBold" numberOfLines={1}>
            {service.title}
          </ThemedText>
          <ThemedText type="code" style={{ color: theme.brand }}>
            {t("creatorService.fromPrice")} {formatServicePrice(service, locale)}
          </ThemedText>
        </View>
        <SymbolView
          name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
          size={14}
          tintColor={theme.textSecondary}
        />
      </View>
    </Pressable>
  );
}

function crewTag(status: CrewStatus): {
  labelKey: MessageKey;
  tone: "success" | "info" | "neutral";
} {
  if (status === "recruiting") return { labelKey: "crews.statusRecruiting", tone: "success" };
  if (status === "in-production") return { labelKey: "crews.statusInProduction", tone: "info" };
  return { labelKey: "crews.statusClosed", tone: "neutral" };
}

function CreatorCrewRow({ crew, onPress }: { crew: CrewSummary; onPress: () => void }) {
  const t = useTranslations();
  const theme = useTheme();
  const tag = crewTag(crew.status);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <View style={[styles.serviceRow, { borderBottomColor: theme.border }]}>
        <PosterImage uri={crew.coverUrl} label={crew.name} radius={8} style={styles.serviceThumb} />
        <View style={styles.serviceCopy}>
          <View style={styles.metaRow}>
            <Tag label={t(tag.labelKey)} tone={tag.tone} />
          </View>
          <ThemedText type="smallBold" numberOfLines={1}>
            {crew.name}
          </ThemedText>
          {crew.memberCount ? (
            <ThemedText type="code" themeColor="textSecondary">
              {crew.memberCount} {t("crews.members")}
            </ThemedText>
          ) : null}
        </View>
        <SymbolView
          name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
          size={14}
          tintColor={theme.textSecondary}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fullCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: {
    height: 250,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  heroScrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(7,8,12,0.58)",
  },
  heroCopy: {
    width: "100%",
    maxWidth: MaxContentWidth,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing.three,
    padding: Spacing.four,
  },
  avatar: {
    width: 74,
    height: 74,
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  identity: { flex: 1, minWidth: 0, gap: Spacing.one },
  name: { fontSize: 26, lineHeight: 30 },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.one,
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.five,
  },
  section: {
    gap: Spacing.two,
  },
  paragraph: {
    lineHeight: 22,
  },
  levelWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  serviceList: {
    gap: Spacing.two,
  },
  serviceRow: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  serviceThumb: {
    width: 92,
    aspectRatio: 16 / 10,
  },
  serviceCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.one,
  },
  pressed: {
    opacity: 0.78,
  },
});
