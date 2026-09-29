import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useAuth } from "@/auth";
import { useLocale, useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { EmptyState, PosterImage, ScreenHeader } from "@/components/ui";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import {
  courseCover,
  getCourse,
  getLessonUrl,
  listCourses,
  orderedLessons,
  type CourseDetail,
} from "./api";
import { useCourseRead } from "./use-course-read";
import { appEnv } from "@/config";
import {
  lessonProgressKey,
  readLessonProgress,
  trackLessonProgress,
  type LessonProgress,
} from "./lesson-progress";

function useScope() {
  const auth = useAuth();
  const locale = useLocale();
  return JSON.stringify([
    locale,
    auth.status,
    auth.user?.id ?? auth.user?.userId,
    auth.session?.region,
    auth.session?.updatedAt,
  ]);
}
function Failure({ message, retry }: { message: string; retry: () => void }) {
  const t = useTranslations();
  return (
    <EmptyState
      title={t("courses.error")}
      detail={message}
      action={{ label: t("courses.retry"), onPress: retry }}
    />
  );
}
export function CoursesScreen() {
  return <Catalog key={useScope()} />;
}
function Catalog() {
  const t = useTranslations();
  const locale = useLocale();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const read = useCourseRead(
    useCallback((signal: AbortSignal) => listCourses(locale, signal), [locale])
  );
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const courses = read.data?.filter((course) =>
    [course.title, course.description, ...(course.instructors ?? []).map((i) => i.nickName)].some(
      (text) => (text ?? "").toLocaleLowerCase().includes(query)
    )
  );
  return (
    <ThemedView style={styles.screen}>
      <FlatList
        data={courses ?? []}
        onRefresh={read.retry}
        refreshing={!read.data && !read.error}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.three, paddingBottom: BottomTabInset + insets.bottom },
        ]}
        ListHeaderComponent={
          <View style={styles.section}>
            <ScreenHeader title={t("tabs.courses")} />
            <TextInput
              accessibilityLabel={t("courses.search")}
              placeholder={t("courses.search")}
              placeholderTextColor={theme.textSecondary}
              value={search}
              onChangeText={setSearch}
              style={[styles.search, { color: theme.text, borderColor: theme.border }]}
            />
          </View>
        }
        ListEmptyComponent={
          read.error ? (
            <Failure message={read.error} retry={read.retry} />
          ) : !read.data ? (
            <ActivityIndicator accessibilityLabel={t("courses.loading")} />
          ) : (
            <EmptyState title={t("courses.empty")} detail={t("courses.emptyDetail")} />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({ pathname: "/course/[id]", params: { id: String(item.id) } })
            }
            style={[styles.card, { backgroundColor: theme.backgroundElement }]}
          >
            <PosterImage uri={courseCover(item.coverUrl)} label={item.title} style={styles.cover} />
            <ThemedText type="smallBold">{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {(item.instructors ?? []).map((i) => i.nickName).join(" · ")}
            </ThemedText>
            {!!item.description && (
              <ThemedText type="small" numberOfLines={2}>
                {item.description}
              </ThemedText>
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {t("courses.free")}
            </ThemedText>
          </Pressable>
        )}
      />
    </ThemedView>
  );
}
export function CourseScreen({ id }: { id: string }) {
  return <Detail key={JSON.stringify([useScope(), id])} id={id} />;
}
function Detail({ id }: { id: string }) {
  const locale = useLocale();
  const t = useTranslations();
  const insets = useSafeAreaInsets();
  const read = useCourseRead(
    useCallback(
      async (signal: AbortSignal) => {
        if (!/^[1-9]\d*$/.test(id)) throw new Error(t("courses.invalid"));
        return getCourse(id, locale, signal);
      },
      [id, locale, t]
    )
  );
  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.four }]}
      >
        {read.error ? (
          <Failure message={read.error} retry={read.retry} />
        ) : !read.data ? (
          <ActivityIndicator accessibilityLabel={t("courses.loading")} />
        ) : (
          <CourseContent course={read.data} />
        )}
      </ScrollView>
    </ThemedView>
  );
}
function CourseContent({ course }: { course: CourseDetail }) {
  const auth = useAuth();
  const t = useTranslations();
  const theme = useTheme();
  const lessons = useMemo(() => orderedLessons(course.videos ?? []), [course.videos]);
  const [selected, setSelected] = useState(lessons[0]?.id);
  const active = useScreenActive();
  const userId = auth.user?.id ?? auth.user?.userId;
  const progressKey =
    selected == null
      ? ""
      : lessonProgressKey(
          auth.status === "authenticated" && userId != null ? String(userId) : null,
          appEnv.siteRegion,
          course.id,
          selected
        );
  return (
    <View style={styles.section}>
      <ScreenHeader title={course.title} />
      <ThemedText type="small" themeColor="textSecondary">
        {(course.instructors ?? []).map((i) => i.nickName).join(" · ")}
      </ThemedText>
      {!!course.description && <ThemedText type="small">{course.description}</ThemedText>}
      {selected != null && active ? (
        <LessonPlayback key={selected} id={selected} progressKey={progressKey} />
      ) : null}
      <ThemedText type="smallBold">{t("courses.lessons")}</ThemedText>
      {!lessons.length && (
        <EmptyState title={t("courses.noLessons")} detail={t("courses.emptyDetail")} />
      )}
      {lessons.map((lesson, index) => (
        <Pressable
          key={lesson.id}
          accessibilityRole="button"
          accessibilityState={{ selected: lesson.id === selected }}
          onPress={() => setSelected(lesson.id)}
          style={[
            styles.lesson,
            {
              backgroundColor:
                lesson.id === selected ? theme.backgroundSelected : theme.backgroundElement,
            },
          ]}
        >
          <ThemedText type="smallBold">
            {index + 1}. {lesson.title}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
function LessonPlayback({ id, progressKey }: { id: number; progressKey: string }) {
  const locale = useLocale();
  const t = useTranslations();
  const [attempt, setAttempt] = useState(0);
  return (
    <LessonRead
      key={attempt}
      id={id}
      progressKey={progressKey}
      locale={locale}
      retry={() => setAttempt((n) => n + 1)}
      loadingLabel={t("courses.loading")}
    />
  );
}
function LessonRead({
  id,
  locale,
  retry,
  loadingLabel,
  progressKey,
}: {
  id: number;
  locale: string;
  retry: () => void;
  loadingLabel: string;
  progressKey: string;
}) {
  const t = useTranslations();
  const read = useCourseRead(
    useCallback(
      async (signal: AbortSignal) => {
        const [url, progress] = await Promise.all([
          getLessonUrl(id, locale, signal),
          readLessonProgress(progressKey),
        ]);
        if (!url || !/^https?:\/\//i.test(url)) throw new Error(t("courses.playError"));
        return { url, progress };
      },
      [id, locale, t, progressKey]
    )
  );
  return read.error ? (
    <Failure message={read.error} retry={retry} />
  ) : read.data ? (
    <LessonVideo
      url={read.data.url}
      initial={read.data.progress}
      progressKey={progressKey}
      retry={retry}
    />
  ) : (
    <ActivityIndicator accessibilityLabel={loadingLabel} />
  );
}
function LessonVideo({
  url,
  retry,
  initial,
  progressKey,
}: {
  url: string;
  retry: () => void;
  initial: LessonProgress | null;
  progressKey: string;
}) {
  const t = useTranslations();
  const player = useVideoPlayer(url, (instance) => {
    instance.staysActiveInBackground = false;
  });
  useLayoutEffect(
    () => trackLessonProgress(player, progressKey, initial),
    [player, progressKey, initial]
  );
  useLayoutEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        /* Already released. */
      }
    },
    [player]
  );
  const { status, error } = useEvent(player, "statusChange", {
    status: player.status,
    error: undefined,
  });
  return (
    <View style={styles.section}>
      <VideoView
        player={player}
        nativeControls
        fullscreenOptions={{ enable: true }}
        contentFit="contain"
        style={styles.video}
      />
      {status === "loading" && <ActivityIndicator accessibilityLabel={t("courses.loading")} />}
      {status === "error" && (
        <Failure message={error?.message || t("courses.playError")} retry={retry} />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    padding: Spacing.four,
    gap: Spacing.three,
  },
  section: { gap: Spacing.three },
  search: { minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
  card: { padding: Spacing.three, borderRadius: 8, gap: Spacing.two, marginBottom: Spacing.three },
  cover: { width: "100%", aspectRatio: 16 / 9 },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
  lesson: { padding: Spacing.three, minHeight: 44, borderRadius: 8 },
});
