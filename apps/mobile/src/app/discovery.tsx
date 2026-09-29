import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth, useAuthGate } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { PosterImage } from "@/components/ui";
import { toHref } from "@/lib/navigation";
import { likeIp, unlikeIp } from "@/data/ip-api";
import { invalidateBrowse } from "@/data/browse-refresh";
import type { IpSummary, IpEngagementSnapshot } from "@/data/types";
import { useDiscoveryFeed } from "@/features/browse/use-discovery-feed";

export default function DiscoveryScreen() {
  const auth = useAuth(),
    active = useScreenActive(),
    locale = useLocale();
  if (!active || auth.status === "hydrating") return null;
  return <DiscoveryFeed key={JSON.stringify([auth.generation, locale])} />;
}
function DiscoveryFeed() {
  const auth = useAuth(),
    theme = useTheme(),
    t = useTranslations();
  const [genreCode, setGenre] = useState<string>(),
    [typeCode, setType] = useState<string>();
  const [height, setHeight] = useState(0),
    [index, setIndex] = useState(0),
    [pendingAdvance, setPendingAdvance] = useState<number>(),
    [revision, setRevision] = useState(0);
  const feed = useDiscoveryFeed(String(auth.generation), { genreCode, typeCode });
  const list = useRef<FlatList<IpSummary>>(null);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (pendingAdvance === undefined || pendingAdvance >= feed.items.length) return;
    list.current?.scrollToIndex({ index: pendingAdvance, animated: true });
  }, [pendingAdvance, feed.items.length]);
  const changeFilter = (set: (value: string | undefined) => void, value: string | undefined) => {
    set(value);
    setIndex(0);
    setPendingAdvance(undefined);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const skip = () => {
    const next = index + 1;
    if (next < feed.items.length) list.current?.scrollToIndex({ index: next, animated: true });
    else if (feed.hasMore) {
      setPendingAdvance(next);
      list.current?.scrollToOffset({ offset: next * height, animated: true });
      feed.loadMore();
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingBottom: insets.bottom }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("discovery.title"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ padding: 8, gap: 10 }}
      >
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: !genreCode }}
          style={{
            padding: 12,
            backgroundColor: !genreCode ? theme.backgroundSelected : undefined,
            borderRadius: 20,
          }}
          onPress={() => changeFilter(setGenre, undefined)}
        >
          <ThemedText>{t("home.genreAll")}</ThemedText>
        </Pressable>
        {feed.genres.map((genre) => (
          <Pressable
            key={genre.code}
            style={{
              padding: 12,
              backgroundColor: genreCode === genre.code ? theme.backgroundSelected : undefined,
              borderRadius: 20,
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: genreCode === genre.code }}
            onPress={() => changeFilter(setGenre, genre.code)}
          >
            <ThemedText>{genre.label}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ padding: 8, gap: 10 }}
      >
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ selected: !typeCode }}
          style={{
            padding: 12,
            backgroundColor: !typeCode ? theme.backgroundSelected : undefined,
            borderRadius: 20,
          }}
          onPress={() => changeFilter(setType, undefined)}
        >
          <ThemedText>{t("home.typeAll")}</ThemedText>
        </Pressable>
        {feed.typeTags.map((tag) => (
          <Pressable
            key={tag.code}
            style={{
              padding: 12,
              backgroundColor: typeCode === tag.code ? theme.backgroundSelected : undefined,
              borderRadius: 20,
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: typeCode === tag.code }}
            onPress={() => changeFilter(setType, tag.code)}
          >
            <ThemedText>{tag.label}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flex: 1 }} onLayout={(event) => setHeight(event.nativeEvent.layout.height)}>
        {height > 0 && (
          <FlatList
            key={JSON.stringify([genreCode, typeCode, revision, height])}
            initialScrollIndex={index < feed.items.length ? index : undefined}
            extraData={index}
            ref={list}
            data={feed.items}
            keyExtractor={(item) => item.id}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
            onScrollToIndexFailed={({ index: target }) =>
              list.current?.scrollToOffset({ offset: target * height, animated: false })
            }
            onMomentumScrollEnd={(event) => {
              setIndex(Math.max(0, Math.round(event.nativeEvent.contentOffset.y / height)));
              setPendingAdvance(undefined);
            }}
            onEndReached={feed.loadMore}
            onEndReachedThreshold={1}
            renderItem={({ item, index: itemIndex }) => (
              <DiscoveryCard
                key={`${item.id}:${auth.generation}`}
                item={item}
                height={height}
                visible={itemIndex === index}
                skip={skip}
                canSkip={itemIndex < feed.items.length - 1 || feed.hasMore}
              />
            )}
            ListFooterComponent={
              <View
                style={{
                  height: feed.items.length ? height : undefined,
                  padding: 24,
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                {feed.loading && <ActivityIndicator />}
                {feed.error && (
                  <>
                    <ThemedText accessibilityRole="alert">{feed.error}</ThemedText>
                    <Pressable accessibilityRole="button" onPress={feed.retry}>
                      <ThemedText>{t("inbox.retry")}</ThemedText>
                    </Pressable>
                  </>
                )}
                {!feed.loading && !feed.error && (
                  <>
                    <ThemedText>
                      {t(
                        feed.hasMore
                          ? "discovery.more"
                          : feed.items.length
                            ? "discovery.end"
                            : "discovery.empty"
                      )}
                    </ThemedText>
                    <Pressable
                      accessibilityRole="button"
                      onPress={
                        feed.hasMore
                          ? feed.loadMore
                          : () => {
                              setIndex(0);
                              setPendingAdvance(undefined);
                              setRevision((v) => v + 1);
                              feed.refresh();
                            }
                      }
                    >
                      <ThemedText>
                        {t(feed.hasMore ? "discovery.more" : "thread.refresh")}
                      </ThemedText>
                    </Pressable>
                  </>
                )}
              </View>
            }
          />
        )}
      </View>
    </View>
  );
}
function DiscoveryCard({
  item,
  height,
  visible,
  skip,
  canSkip,
}: {
  item: IpSummary;
  height: number;
  visible: boolean;
  skip: () => void;
  canSkip: boolean;
}) {
  const auth = useAuth(),
    gate = useAuthGate(),
    op = useAuthFormOperation(item.id, true),
    theme = useTheme(),
    t = useTranslations(),
    router = useRouter();
  const [engagement, setEngagement] = useState<IpEngagementSnapshot>(),
    [error, setError] = useState<string>();
  const current = engagement ?? item;
  return (
    <View style={{ height, padding: 16, gap: 10 }}>
      <PosterImage uri={item.backdropUrl || item.coverUrl} label={item.title} style={{ flex: 1 }} />
      <ThemedText type="subtitle" numberOfLines={2}>
        {item.title}
      </ThemedText>
      <ThemedText numberOfLines={1}>{item.creator}</ThemedText>
      <ThemedText numberOfLines={3}>{item.synopsis || item.tagline}</ThemedText>
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("discovery.skip")}
          disabled={!visible || !canSkip}
          onPress={skip}
          style={{ padding: 16 }}
        >
          <ThemedText type="subtitle">×</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!visible}
          onPress={() => router.push(toHref(`/ip/${encodeURIComponent(item.id)}`))}
        >
          <ThemedText>{t("discovery.open")}</ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(current.viewerHasLiked ? "discovery.unlike" : "discovery.like")}
          accessibilityState={{ selected: current.viewerHasLiked, disabled: op.busy }}
          disabled={!visible || op.busy}
          onPress={() => {
            if (auth.status !== "authenticated") {
              gate.requireAuth();
              return;
            }
            void op.run(
              () => (current.viewerHasLiked ? unlikeIp(item.id) : likeIp(item.id)),
              (result) => {
                setEngagement(
                  result ?? {
                    ...current,
                    viewerHasLiked: !current.viewerHasLiked,
                    likeCount: Math.max(0, current.likeCount + (current.viewerHasLiked ? -1 : 1)),
                  }
                );
                setError(undefined);
                invalidateBrowse();
              },
              (cause) => setError(cause instanceof Error ? cause.message : String(cause))
            );
          }}
          style={{
            padding: 16,
            backgroundColor: current.viewerHasLiked ? theme.backgroundSelected : undefined,
          }}
        >
          <ThemedText type="subtitle">{current.viewerHasLiked ? "♥" : "♡"}</ThemedText>
          <ThemedText type="small">{current.likeCount}</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}
