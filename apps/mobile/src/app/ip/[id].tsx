import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, SectionHeader, Tag } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { getIpById } from "@/data/browse-service";
import type { IpDetail, IpEpisode, Person } from "@/data/types";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";

export default function IpDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const t = useTranslations();
  const [ip, setIp] = useState<IpDetail>();
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const data = await getIpById(id);
        if (alive) setIp(data);
      } catch {
        if (alive) setIp(undefined);
      } finally {
        if (alive) setLoading(false);
      }
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

  if (!ip) {
    return (
      <ThemedView style={[styles.fullCenter, { padding: Spacing.four }]}>
        <EmptyState
          title={t("ipDetail.notFoundTitle")}
          detail={t("ipDetail.notFoundDetail")}
          symbol={{ ios: "film", android: "movie", web: "movie" }}
        />
      </ThemedView>
    );
  }

  const metaParts = [
    ip.year?.toString(),
    ip.genres.slice(0, 2).join(" · "),
    ip.episodeCount ? `${ip.episodeCount} ${t("ipDetail.episodesUnit")}` : undefined,
  ].filter(Boolean);

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.seven }}
      >
        <View style={styles.backdrop}>
          <PosterImage
            uri={ip.backdropUrl ?? ip.coverUrl}
            label={ip.title}
            radius={0}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.backdropScrim} />
          <View style={styles.backdropCopy}>
            <ThemedText type="subtitle" style={styles.title} numberOfLines={2}>
              {ip.title}
            </ThemedText>
            <View style={styles.metaRow}>
              {ip.rating != null ? (
                <View style={styles.ratingRow}>
                  <SymbolView
                    name={{ ios: "star.fill", android: "star", web: "star" }}
                    size={12}
                    tintColor={theme.brand}
                  />
                  <ThemedText type="code" style={{ color: theme.brand }}>
                    {ip.rating.toFixed(1)}
                  </ThemedText>
                </View>
              ) : null}
              <ThemedText type="code" themeColor="textSecondary">
                {metaParts.join("  ·  ")}
              </ThemedText>
            </View>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {}}
              style={({ pressed }) => [
                styles.playButton,
                { backgroundColor: theme.brand },
                pressed && styles.pressed,
              ]}
            >
              <SymbolView
                name={{ ios: "play.fill", android: "play_arrow", web: "play_arrow" }}
                size={16}
                tintColor="#FFFFFF"
              />
              <ThemedText type="smallBold" style={styles.playText}>
                {t("ipDetail.play")}
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {}}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <ThemedView type="backgroundElement" style={styles.secondaryButton}>
                <SymbolView
                  name={{ ios: "plus", android: "add", web: "add" }}
                  size={16}
                  tintColor={theme.text}
                />
                <ThemedText type="smallBold">{t("ipDetail.myList")}</ThemedText>
              </ThemedView>
            </Pressable>
          </View>

          {ip.roomCode ? (
            <ThemedView type="backgroundElement" style={styles.roomChip}>
              <SymbolView
                name={{ ios: "number", android: "tag", web: "tag" }}
                size={14}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="code" themeColor="textSecondary">
                {t("ipDetail.room")}
              </ThemedText>
              <ThemedText type="smallBold" style={{ color: theme.brand }}>
                {ip.roomCode}
              </ThemedText>
            </ThemedView>
          ) : null}

          <View style={styles.section}>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={expanded ? undefined : 4}
            >
              {ip.longSynopsis}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
              <ThemedText type="smallBold" style={{ color: theme.brand }}>
                {expanded ? t("ipDetail.showLess") : t("ipDetail.showMore")}
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.tagWrap}>
            {ip.tags.map((tag) => (
              <Tag key={tag} label={tag} />
            ))}
          </View>

          {ip.episodes.length ? (
            <View style={styles.section}>
              <SectionHeader
                title={t("ipDetail.episodesTitle")}
                trailing={`${ip.episodeCount ?? ip.episodes.length} ${t("ipDetail.episodesTotal")}`}
              />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.episodeRow}
              >
                {ip.episodes.map((episode) => (
                  <EpisodeCard key={episode.id} episode={episode} title={ip.title} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionHeader title={t("ipDetail.castTitle")} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.peopleRow}
            >
              {[...ip.creators, ...ip.cast].map((person) => (
                <PersonChip key={person.id} person={person} />
              ))}
            </ScrollView>
          </View>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function EpisodeCard({ episode, title }: { episode: IpEpisode; title: string }) {
  const t = useTranslations();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {}}
      style={({ pressed }) => [styles.episodeCard, pressed && styles.pressed]}
    >
      <View style={styles.episodeThumbWrap}>
        <PosterImage uri={episode.thumbnailUrl} label={title} style={styles.episodeThumb} />
        <View style={styles.episodePlay}>
          <SymbolView
            name={{ ios: "play.fill", android: "play_arrow", web: "play_arrow" }}
            size={14}
            tintColor="#FFFFFF"
          />
        </View>
        {episode.free ? (
          <View style={styles.freeBadge}>
            <ThemedText type="code" style={styles.freeText}>
              {t("ipDetail.free")}
            </ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText type="smallBold" numberOfLines={1}>
        {`${t("ipDetail.episodePrefix")}${episode.index}${t("ipDetail.episodeSuffix")}`}
      </ThemedText>
      {episode.durationLabel ? (
        <ThemedText type="code" themeColor="textSecondary">
          {episode.durationLabel}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

function PersonChip({ person }: { person: Person }) {
  const theme = useTheme();
  const initial = person.name.trim().slice(0, 1).toUpperCase();
  return (
    <View style={styles.personChip}>
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
        {person.avatarUrl ? (
          <Image
            source={{ uri: person.avatarUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
        ) : (
          <ThemedText type="smallBold" themeColor="textSecondary">
            {initial}
          </ThemedText>
        )}
      </View>
      <ThemedText type="code" numberOfLines={1} style={styles.personName}>
        {person.name}
      </ThemedText>
      {person.role ? (
        <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
          {person.role}
        </ThemedText>
      ) : null}
    </View>
  );
}

const AVATAR = 56;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  fullCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.four,
  },
  backdrop: {
    height: 340,
    justifyContent: "flex-end",
  },
  backdropScrim: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "rgba(7,8,12,0.42)",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
  },
  backdropCopy: {
    padding: Spacing.four,
    gap: Spacing.one,
  },
  title: {
    fontSize: 30,
    lineHeight: 34,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.five,
  },
  actionRow: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  playButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.one,
  },
  playText: {
    color: "#FFFFFF",
  },
  secondaryButton: {
    height: 48,
    paddingHorizontal: Spacing.four,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
  },
  roomChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    height: 32,
    paddingHorizontal: Spacing.three,
    borderRadius: 8,
  },
  section: {
    gap: Spacing.two,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.one,
  },
  episodeRow: {
    gap: Spacing.two,
    paddingRight: Spacing.four,
  },
  episodeCard: {
    width: 150,
    gap: Spacing.one,
  },
  episodeThumbWrap: {
    position: "relative",
  },
  episodeThumb: {
    width: 150,
    height: 86,
  },
  episodePlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 30,
    height: 30,
    marginTop: -15,
    marginLeft: -15,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,14,20,0.55)",
  },
  freeBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(12,14,20,0.7)",
  },
  freeText: {
    color: "#FFFFFF",
    fontSize: 10,
    letterSpacing: 0.4,
  },
  peopleRow: {
    gap: Spacing.four,
    paddingRight: Spacing.four,
  },
  personChip: {
    width: AVATAR + 12,
    alignItems: "center",
    gap: 4,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  personName: {
    color: undefined,
  },
  pressed: {
    opacity: 0.82,
  },
});
