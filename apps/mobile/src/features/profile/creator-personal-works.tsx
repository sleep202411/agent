import { useEffect, useState, useRef } from "react";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { PosterImage, SectionHeader } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
import { getCreatorPersonalWorks, type PublicPersonalWork } from "./personal-work-api";
export function CreatorPersonalWorks({ creatorId }: { creatorId: string }) {
  return <WorkList key={creatorId} creatorId={creatorId} />;
}
function WorkList({ creatorId }: { creatorId: string }) {
  const t = useTranslations();
  const theme = useTheme();
  const pending = useRef(true);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [works, setWorks] = useState<PublicPersonalWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void getCreatorPersonalWorks(creatorId, page, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setWorks((previous) =>
          Array.from(
            new Map([...previous, ...result.works].map((work) => [work.id, work])).values()
          )
        );
        setHasMore(result.hasMore);
        pending.current = false;
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          pending.current = false;
          setFailed(true);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [creatorId, page, attempt]);
  if (!loading && !failed && !works.length && !hasMore) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title={t("creatorDetail.personalWorksTitle")} />
      {works.map((work) => (
        <Pressable
          key={work.id}
          accessibilityRole="button"
          onPress={() => router.push(toHref(`/work/${encodeURIComponent(work.id)}`))}
        >
          <View style={[styles.row, { borderBottomColor: theme.border }]}>
            <PosterImage uri={work.coverUrl} label={work.title} radius={8} style={styles.thumb} />
            <ThemedText type="smallBold" numberOfLines={2} style={styles.title}>
              {work.title || "—"}
            </ThemedText>
          </View>
        </Pressable>
      ))}
      {loading ? (
        <ActivityIndicator />
      ) : failed ? (
        <View>
          <ThemedText accessibilityRole="alert">{t("creatorDetail.personalWorksError")}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (pending.current) return;
              pending.current = true;
              setLoading(true);
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            <ThemedText>{t("profileEdit.retry")}</ThemedText>
          </Pressable>
        </View>
      ) : hasMore ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (pending.current) return;
            pending.current = true;
            setLoading(true);
            setPage((value) => value + 1);
          }}
        >
          <ThemedText>{t("creatorDetail.personalWorksMore")}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  row: {
    minHeight: 86,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 92, aspectRatio: 16 / 10 },
  title: { flex: 1 },
});
