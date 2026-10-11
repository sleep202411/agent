import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  View,
  type ViewStyle,
} from "react-native";
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
import { DiscoveryPreview, type PreviewPlayback } from "@/features/browse/discovery-preview";

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
  const playback = useRef<PreviewPlayback | null>(null);
  const scrolling = useRef(false);
  const dragging = useRef(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(scrollTimer.current), []);
  const settle = (offset: number) => {
    clearTimeout(scrollTimer.current);
    const next = Math.max(0, Math.round(offset / height));
    if (Math.abs(offset - next * height) > 1)
      list.current?.scrollToOffset({ offset: next * height, animated: false });
    if (next === index) playback.current?.resume();
    scrolling.current = false;
    setIndex(next);
    setPendingAdvance(undefined);
    if (feed.items.length && next >= feed.items.length - 1 && feed.hasMore) feed.loadMore();
  };
  useEffect(() => {
    if (pendingAdvance === undefined || pendingAdvance >= feed.items.length) return;
    list.current?.scrollToIndex({ index: pendingAdvance, animated: true });
  }, [pendingAdvance, feed.items.length]);
  const changeFilter = (set: (value: string | undefined) => void, value: string | undefined) => {
    clearTimeout(scrollTimer.current);
    scrolling.current = false;
    dragging.current = false;
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
            // Start a fresh list after an empty/loading result. Otherwise web
            // scroll anchoring can follow the footer past newly inserted cards.
            key={JSON.stringify([genreCode, typeCode, revision, height, feed.items.length === 0])}
            initialScrollIndex={index < feed.items.length ? index : undefined}
            extraData={index}
            ref={list}
            // Replacing an offscreen player must not move the browser's scroll
            // anchor or cancel the native-style animated skip.
            style={
              Platform.OS === "web" ? ({ flex: 1, overflowAnchor: "none" } as ViewStyle) : undefined
            }
            data={feed.items}
            keyExtractor={(item) => item.id}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })}
            onScrollToIndexFailed={({ index: target }) =>
              list.current?.scrollToOffset({ offset: target * height, animated: false })
            }
            onMomentumScrollEnd={(event) => {
              dragging.current = false;
              settle(event.nativeEvent.contentOffset.y);
            }}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              dragging.current = true;
              setPendingAdvance(undefined);
            }}
            onScrollEndDrag={(event) => {
              dragging.current = false;
              const offset = event.nativeEvent.contentOffset.y;
              clearTimeout(scrollTimer.current);
              scrollTimer.current = setTimeout(() => settle(offset), 120);
            }}
            onScroll={(event) => {
              const offset = event.nativeEvent.contentOffset.y;
              if (!scrolling.current) {
                scrolling.current = true;
                playback.current?.pause();
              }
              clearTimeout(scrollTimer.current);
              // Keep the list tree stable during a smooth scroll. Web's CSS snap
              // animation can be canceled by re-rendering its children per frame.
              scrollTimer.current = setTimeout(() => {
                if (!dragging.current) settle(offset);
              }, 120);
            }}
            onEndReached={() => {
              if (!scrolling.current) feed.loadMore();
            }}
            onEndReachedThreshold={1}
            renderItem={({ item, index: itemIndex }) => (
              <DiscoveryCard
                key={`${item.id}:${auth.generation}`}
                item={item}
                height={height}
                selected={itemIndex === index}
                visible={itemIndex === index}
                playback={playback}
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
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        if (!feed.items.length) {
                          clearTimeout(scrollTimer.current);
                          setIndex(0);
                          setPendingAdvance(undefined);
                        }
                        feed.retry();
                      }}
                    >
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
                              clearTimeout(scrollTimer.current);
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
  selected,
  playback,
  skip,
  canSkip,
}: {
  item: IpSummary;
  height: number;
  visible: boolean;
  selected: boolean;
  playback: RefObject<PreviewPlayback | null>;
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
      {selected ? (
        <DiscoveryPreview key={item.id} ipId={item.id} active={visible} playback={playback} />
      ) : (
        <PosterImage
          uri={item.backdropUrl || item.coverUrl}
          label={item.title}
          style={{ flex: 1 }}
        />
      )}
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
