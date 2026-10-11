import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { SectionHeader } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { useLocale, useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
import { getCreatorById } from "@/data/browse-service";
import { fetchCreatorReviews, type CreatorReviewPage } from "./creator-reviews-api";

export function CreatorReviews({ creatorId }: { creatorId: string }) {
  const active = useScreenActive();
  return active ? <ReviewList key={creatorId} creatorId={creatorId} /> : null;
}
function ReviewList({ creatorId }: { creatorId: string }) {
  const t = useTranslations(),
    locale = useLocale(),
    theme = useTheme();
  const [page, setPage] = useState<CreatorReviewPage>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const session = useRef<{
    abort: AbortController;
    busy: boolean;
    cursor: string | null;
    seen: Set<string>;
  } | null>(null);
  async function load(current: NonNullable<typeof session.current>) {
    if (current.busy || current.abort.signal.aborted) return;
    current.busy = true;
    try {
      const result = await fetchCreatorReviews(creatorId, current.cursor, current.abort.signal);
      if (current.abort.signal.aborted) return;
      if (
        result.nextCursor &&
        (result.nextCursor === current.cursor || current.seen.has(result.nextCursor))
      )
        throw new Error(t("contentGpsDiscovery.responseMismatch"));
      if (current.cursor) current.seen.add(current.cursor);
      setPage((previous) => ({
        ...result,
        summary: previous?.summary ?? result.summary,
        items: [
          ...new Map(
            [...(previous?.items ?? []), ...result.items].map((row) => [row.id, row])
          ).values(),
        ],
      }));
      current.cursor = result.nextCursor;
    } catch (cause) {
      if (!current.abort.signal.aborted)
        setError(cause instanceof Error ? cause.message : t("creatorDetail.experienceFailed"));
    } finally {
      current.busy = false;
      if (!current.abort.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const current = {
      abort: new AbortController(),
      busy: false,
      cursor: null,
      seen: new Set<string>(),
    };
    session.current = current;
    // A retired mount must not start a request; load checks cancellation first.
    queueMicrotask(() => void load(current));
    return () => {
      current.abort.abort();
      session.current = null;
    };
    // The keyed session owns this creator; locale changes remount the parent screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId]);
  const score = (value: number | null) =>
    value === null
      ? t("creatorReviews.unrated")
      : t("creatorReviews.score").replace(
          "{value}",
          value.toLocaleString(locale, { maximumFractionDigits: 2 })
        );
  const button = { minHeight: 44, justifyContent: "center" as const };
  return (
    <View style={{ gap: 12 }}>
      <SectionHeader title={t("creatorReviews.reviews")} />
      {page && (
        <>
          {(["creator", "manager"] as const).map((direction) => (
            <View key={direction} style={{ gap: 4 }}>
              <ThemedText type="smallBold">{t(`creatorReviews.${direction}`)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t(`creatorReviews.${direction}Hint`)}
              </ThemedText>
              <ThemedText type="small">
                {score(page.summary[direction].average)} ·{" "}
                {t("creatorReviews.reviewCount").replace(
                  "{count}",
                  String(page.summary[direction].count)
                )}
              </ThemedText>
              <ReviewStars value={page.summary[direction].average} />
            </View>
          ))}
          <ThemedText type="smallBold">
            {t("creatorReviews.overall")}: {score(page.summary.average)}
          </ThemedText>
          <ReviewStars value={page.summary.average} />
          <ThemedText type="small">
            {t("creatorReviews.reviewCount").replace("{count}", String(page.summary.total))}
          </ThemedText>
          <View accessibilityLabel={t("creatorReviews.distribution")} style={{ gap: 4 }}>
            {[5, 4, 3, 2, 1].map((star) => (
              <View key={star} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ThemedText type="small">{star}</ThemedText>
                <View style={{ flex: 1, height: 6, backgroundColor: theme.backgroundElement }}>
                  <View
                    style={{
                      height: 6,
                      backgroundColor: "#FFD84D",
                      width: `${page.summary.total ? Math.min(100, (100 * page.summary.histogram[star - 1]!) / page.summary.total) : 0}%`,
                    }}
                  />
                </View>
                <ThemedText type="small">{page.summary.histogram[star - 1]}</ThemedText>
              </View>
            ))}
          </View>
          {page.summary.total === 0 && (
            <ThemedText type="small">{t("creatorReviews.empty")}</ThemedText>
          )}
        </>
      )}
      {page?.items.map((row) => (
        <View
          key={row.id}
          style={{
            gap: 6,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}
        >
          <Pressable
            accessibilityRole="button"
            style={button}
            onPress={() => router.push(toHref(`/creator/${encodeURIComponent(row.authorUserId)}`))}
          >
            <ReviewerName userId={row.authorUserId} />
          </Pressable>
          <ThemedText type="small">
            {t(`creatorReviews.${row.direction}`)} ·{" "}
            {new Date(row.createdAt).toLocaleDateString(locale)}
          </ThemedText>
          <ThemedText type="small">{score(row.scoreMilli / 1000)}</ThemedText>
          <ReviewStars value={row.scoreMilli / 1000} />
          {!!row.comment && <ThemedText type="small">{row.comment}</ThemedText>}
          {row.timelinessScore !== null && (
            <ThemedText type="small">
              {t("creatorReviews.timeliness").replace("{score}", String(row.timelinessScore))}
            </ThemedText>
          )}
        </View>
      ))}
      {loading && <ActivityIndicator accessibilityLabel={t("creatorReviews.loading")} />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {(error || page?.nextCursor) && (
        <Pressable
          accessibilityRole="button"
          style={button}
          disabled={loading}
          onPress={() => {
            if (session.current && !session.current.busy) {
              setLoading(true);
              setError(undefined);
              void load(session.current);
            }
          }}
        >
          <ThemedText>{t(error ? "creatorReviews.retry" : "creatorReviews.more")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

function ReviewerName({ userId }: { userId: string }) {
  const t = useTranslations();
  const [name, setName] = useState<string>();
  useEffect(() => {
    let alive = true;
    void getCreatorById(userId)
      .then((profile) => {
        if (alive) setName(profile?.name);
      })
      .catch(() => {
        /* The public reviewer link remains usable when identity lookup fails. */
      });
    return () => {
      alive = false;
    };
  }, [userId]);
  return (
    <ThemedText type="smallBold">
      {name || t("creatorReviews.reviewer").replace("{id}", userId)}
    </ThemedText>
  );
}

function ReviewStars({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <View aria-hidden style={{ flexDirection: "row", alignSelf: "flex-start" }}>
      {[0, 1, 2, 3, 4].map((index) => (
        <View key={index}>
          <ThemedText style={{ color: "#555555", fontSize: 20 }}>★</ThemedText>
          <View
            style={{
              position: "absolute",
              overflow: "hidden",
              width: `${Math.max(0, Math.min(1, value - index)) * 100}%`,
            }}
          >
            <ThemedText style={{ color: "#FFD84D", fontSize: 20 }}>★</ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}
