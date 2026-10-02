import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IpGrid } from "@/components/ip-grid";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, SectionHeader, Tag } from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { getCreatorById, getCreatorIps, getCrewsByUser } from "@/data/browse-service";
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

import {
  fetchCreatorServicesPage,
  InvalidCreatorServicesPageError,
} from "@/data/creator-service-api";
import { CreatorPersonalWorks } from "@/features/profile/creator-personal-works";
import { CreatorExperience } from "@/features/profile/creator-experience";
import { CreatorCertificates } from "@/features/certificates/creator-certificates";
import { CreatorEducation } from "@/features/profile/creator-education";

export default function CreatorDetailScreen() {
  const { id, section } = useLocalSearchParams<{ id: string; section?: string | string[] }>();
  const servicesRequested = section === "services";
  return (
    <CreatorDetailContent
      key={JSON.stringify([id, servicesRequested])}
      id={id}
      servicesRequested={servicesRequested}
    />
  );
}

function CreatorDetailContent({
  id,
  servicesRequested,
}: {
  id: string;
  servicesRequested: boolean;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useTranslations();
  const locale = useLocale();
  const scroll = useRef<ScrollView>(null);
  const anchor = useRef({
    following: servicesRequested,
    body: null as number | null,
    services: null as number | null,
  });
  const scrollToServices = () => {
    const target = anchor.current;
    if (target.following && target.body !== null && target.services !== null) {
      scroll.current?.scrollTo({
        y: Math.max(0, target.body + target.services - insets.top - 56),
        animated: false,
      });
    }
  };
  const stopFollowing = () => {
    anchor.current.following = false;
  };
  const requestError = (cause: unknown) =>
    cause instanceof InvalidCreatorServicesPageError
      ? t("contentGpsDiscovery.responseMismatch")
      : cause instanceof Error
        ? cause.message
        : String(cause);
  const [creator, setCreator] = useState<CreatorSummary>();
  const [services, setServices] = useState<CreatorServiceSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string>();
  const moreRequest = useRef<AbortController | null>(null);
  const seenCursors = useRef(new Set<string>());
  async function loadMore() {
    if (!nextCursor || moreRequest.current) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setMoreBusy(true);
    setMoreError(undefined);
    try {
      const page = await fetchCreatorServicesPage(id, nextCursor, controller.signal);
      if (controller.signal.aborted) return;
      if (page.nextCursor && seenCursors.current.has(page.nextCursor))
        throw Error(t("contentGpsDiscovery.responseMismatch"));
      seenCursors.current.add(nextCursor);
      setServices((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted) setMoreError(requestError(cause));
    } finally {
      if (moreRequest.current === controller) {
        moreRequest.current = null;
        setMoreBusy(false);
      }
    }
  }
  const [works, setWorks] = useState<IpSummary[]>([]);
  const [crews, setCrews] = useState<CrewSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState({
    services: true,
    works: true,
    crews: true,
  });
  const [revision, setRevision] = useState(0);
  const [errors, setErrors] = useState<
    Partial<Record<"profile" | "services" | "works" | "crews", string>>
  >({});

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    moreRequest.current?.abort();
    moreRequest.current = null;
    setNextCursor(null);
    setMoreBusy(false);
    setMoreError(undefined);
    seenCursors.current.clear();
    setLoading(true);
    setErrors({});
    setSectionLoading({ services: true, works: true, crews: true });
    setServices([]);
    setWorks([]);
    setCrews([]);
    async function load<T>(
      key: "profile" | "services" | "works" | "crews",
      request: () => Promise<T>,
      receive: (value: T) => void
    ) {
      try {
        const value = await request();
        if (alive) receive(value);
      } catch (cause) {
        if (alive) {
          if (key === "profile") setCreator(undefined);
          setErrors((current) => ({
            ...current,
            [key]:
              cause instanceof InvalidCreatorServicesPageError
                ? t("contentGpsDiscovery.responseMismatch")
                : cause instanceof Error
                  ? cause.message
                  : String(cause),
          }));
        }
      } finally {
        if (alive) {
          if (key === "profile") setLoading(false);
          else setSectionLoading((current) => ({ ...current, [key]: false }));
        }
      }
    }
    void load("profile", () => getCreatorById(id), setCreator);
    void load(
      "services",
      () => fetchCreatorServicesPage(id, undefined, controller.signal),
      (page) => {
        setServices(page.items);
        setNextCursor(page.nextCursor);
      }
    );
    void load("works", () => getCreatorIps(id), setWorks);
    void load("crews", () => getCrewsByUser(id), setCrews);
    return () => {
      alive = false;
      controller.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
    };
  }, [id, revision, t]);

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
        {errors.profile ? (
          <>
            <ThemedText accessibilityRole="alert">{errors.profile}</ThemedText>
            <Pressable accessibilityRole="button" onPress={() => setRevision((n) => n + 1)}>
              <ThemedText>{t("common.retry")}</ThemedText>
            </Pressable>
          </>
        ) : (
          <EmptyState
            title={t("creatorDetail.notFoundTitle")}
            detail={t("creatorDetail.notFoundDetail")}
            symbol={{ ios: "person.crop.circle", android: "person", web: "person" }}
          />
        )}
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
        ref={scroll}
        onScrollBeginDrag={stopFollowing}
        onTouchStart={stopFollowing}
        onContentSizeChange={scrollToServices}
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

        <View
          style={styles.body}
          onLayout={(event) => {
            anchor.current.body = event.nativeEvent.layout.y;
            scrollToServices();
          }}
        >
          {(errors.works || errors.crews) && (
            <View style={styles.section}>
              {(
                [
                  ["works", "creatorDetail.worksTitle"],
                  ["crews", "creatorDetail.crewsTitle"],
                ] as const
              ).map(([key, label]) =>
                errors[key] ? (
                  <ThemedText key={key} accessibilityRole="alert">
                    {t(label)}: {errors[key]}
                  </ThemedText>
                ) : null
              )}
              <Pressable accessibilityRole="button" onPress={() => setRevision((n) => n + 1)}>
                <ThemedText>{t("common.retry")}</ThemedText>
              </Pressable>
            </View>
          )}
          <View style={styles.section}>
            <SectionHeader title={t("creatorDetail.aboutTitle")} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.paragraph}>
              {creator.bio || t("creatorDetail.bioEmpty")}
            </ThemedText>
          </View>

          <CreatorEducation study={creator.study} />
          <CreatorCertificates creatorId={creator.id} />
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

          {sectionLoading.works ? (
            <View style={styles.section}>
              <SectionHeader title={t("creatorDetail.worksTitle")} />
              <ActivityIndicator
                accessibilityLabel={t("creatorDetail.worksTitle")}
                color={theme.textSecondary}
              />
            </View>
          ) : works.length ? (
            <View style={styles.section}>
              <SectionHeader title={t("creatorDetail.worksTitle")} trailing={`${works.length}`} />
              <IpGrid ips={works} />
            </View>
          ) : null}

          {sectionLoading.crews ? (
            <View style={styles.section}>
              <SectionHeader title={t("creatorDetail.crewsTitle")} />
              <ActivityIndicator
                accessibilityLabel={t("creatorDetail.crewsTitle")}
                color={theme.textSecondary}
              />
            </View>
          ) : crews.length ? (
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

          <View
            style={styles.section}
            onLayout={(event) => {
              anchor.current.services = event.nativeEvent.layout.y;
              scrollToServices();
            }}
          >
            <SectionHeader
              title={t("creatorDetail.servicesTitle")}
              trailing={
                sectionLoading.services || errors.services ? undefined : `${services.length}`
              }
            />
            {errors.services && (
              <View style={{ gap: Spacing.two }}>
                <ThemedText accessibilityRole="alert">{errors.services}</ThemedText>
                <Pressable
                  accessibilityRole="button"
                  style={{ minHeight: 44, justifyContent: "center" }}
                  onPress={() => {
                    // Retrying remounts the scroll view; return to the failed section.
                    anchor.current = { following: true, body: null, services: null };
                    setRevision((n) => n + 1);
                  }}
                >
                  <ThemedText>{t("common.retry")}</ThemedText>
                </Pressable>
              </View>
            )}
            {sectionLoading.services ? (
              <ActivityIndicator
                accessibilityLabel={t("creatorDetail.servicesTitle")}
                color={theme.textSecondary}
              />
            ) : services.length ? (
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
            ) : !errors.services ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t("creatorDetail.servicesEmpty")}
              </ThemedText>
            ) : null}
            {moreError && <ThemedText accessibilityRole="alert">{moreError}</ThemedText>}
            {nextCursor && (
              <Pressable
                accessibilityRole="button"
                disabled={moreBusy}
                onPress={() => void loadMore()}
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                {moreBusy ? (
                  <ActivityIndicator />
                ) : (
                  <ThemedText>{t(moreError ? "common.retry" : "myServices.loadMore")}</ThemedText>
                )}
              </Pressable>
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
