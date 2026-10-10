import { useCallback, useEffectEvent, useLayoutEffect, useMemo, useState } from "react";
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
import { useAuth, useAuthGate } from "@/auth";
import { useLocale, useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTabScreenInsets } from "@/components/tab-screen";
import { EmptyState, PosterImage, ScreenHeader } from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import {
  courseCover,
  getCourse,
  getLessonUrl,
  listCourses,
  orderedLessons,
  validCourseId,
  type Course,
  type CourseDetail,
} from "./api";
import {
  readSelectedLesson,
  saveSelectedLesson,
  readCoursePercent,
  saveCoursePercent,
} from "./course-history";
import { useCourseRead } from "./use-course-read";
import { CourseCertificate } from "./course-certificate";
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
function useProgressKey(courseId: number) {
  const auth = useAuth();
  const userId = auth.user?.id ?? auth.user?.userId;
  const account = auth.status === "authenticated" && userId != null ? String(userId) : null;
  return useCallback(
    (lessonId: number) => lessonProgressKey(account, appEnv.siteRegion, courseId, lessonId),
    [account, courseId]
  );
}
function CourseProgress({ course }: { course: Course }) {
  const key = useProgressKey(course.id)(0);
  const t = useTranslations();
  const read = useCourseRead(useCallback(() => readCoursePercent(key), [key]));
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {course.videoCount != null
        ? t("courses.lessonCount").replace("{count}", String(course.videoCount))
        : ""}
      {read.data != null
        ? `${course.videoCount != null ? " · " : ""}${t("courses.progress").replace("{percent}", String(read.data))}`
        : ""}
    </ThemedText>
  );
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
  const { contentPadding } = useTabScreenInsets();
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
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[styles.content, contentPadding]}
        ListHeaderComponent={
          <View style={styles.section}>
            <ScreenHeader title={t("courses.title")} />
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
              router.push({ pathname: "/courses/[id]", params: { id: String(item.id) } })
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
            <CourseProgress course={item} />
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
        if (!validCourseId(id)) throw new Error(t("courses.invalid"));
        return getCourse(id, locale, signal);
      },
      [id, locale, t]
    )
  );
  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { padding: Spacing.four, paddingBottom: insets.bottom + Spacing.four },
        ]}
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
  const key = useProgressKey(course.id)(0);
  const lessons = useMemo(() => orderedLessons(course.videos), [course.videos]);
  const read = useCourseRead(
    useCallback(
      async () => ({
        selected: await readSelectedLesson(
          key,
          lessons.map((lesson) => lesson.id)
        ),
      }),
      [key, lessons]
    )
  );
  return read.data ? (
    <SelectedCourseContent
      key={lessons.map((lesson) => lesson.id).join(",")}
      course={course}
      initialSelection={read.data.selected}
    />
  ) : (
    <ActivityIndicator />
  );
}
function SelectedCourseContent({
  course,
  initialSelection,
}: {
  course: CourseDetail;
  initialSelection: number | undefined;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const theme = useTheme();
  const lessons = useMemo(() => orderedLessons(course.videos ?? []), [course.videos]);
  const [selected, setSelected] = useState(initialSelection);
  const active = useScreenActive();
  const progressKeyFor = useProgressKey(course.id);
  const courseKey = progressKeyFor(0);
  const progressKey = selected == null ? "" : progressKeyFor(selected);
  const updatePercent = useCallback(
    () =>
      saveCoursePercent(
        courseKey,
        lessons.map((lesson) => progressKeyFor(lesson.id))
      ),
    [courseKey, lessons, progressKeyFor]
  );
  return (
    <View style={styles.section}>
      <ScreenHeader title={course.title} />
      {course.instructors.length ? (
        <View style={{ gap: Spacing.one }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t("courses.instructors")}
          </ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: Spacing.two }}>
            {course.instructors.map((instructor) => (
              <Pressable
                key={instructor.userId}
                accessibilityRole="link"
                style={{ minHeight: 44, justifyContent: "center" }}
                onPress={() =>
                  router.push({
                    pathname: "/creator/[id]",
                    params: { id: String(instructor.userId) },
                  })
                }
              >
                <ThemedText type="smallBold">
                  {instructor.nickName.trim() || t("courses.unknownInstructor")}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {course.updateTime ? (
        <ThemedText type="small" themeColor="textSecondary">
          {Number.isNaN(Date.parse(course.updateTime))
            ? course.updateTime
            : new Date(course.updateTime).toLocaleDateString(locale)}
        </ThemedText>
      ) : null}
      {!!course.description && <ThemedText type="small">{course.description}</ThemedText>}
      {selected != null && active ? (
        <LessonPlayback
          key={selected}
          id={selected}
          progressKey={progressKey}
          onSaved={updatePercent}
        />
      ) : null}
      <CourseCertificate courseId={String(course.id)} />
      <ThemedText type="smallBold">{t("courses.lessons")}</ThemedText>
      {!lessons.length && (
        <EmptyState title={t("courses.noLessons")} detail={t("courses.emptyDetail")} />
      )}
      {lessons.map((lesson, index) => (
        <Pressable
          key={lesson.id}
          accessibilityRole="button"
          accessibilityState={{ selected: lesson.id === selected }}
          onPress={() => {
            setSelected(lesson.id);
            void saveSelectedLesson(courseKey, lesson.id);
          }}
          style={[
            styles.lesson,
            {
              backgroundColor:
                lesson.id === selected ? theme.backgroundSelected : theme.backgroundElement,
            },
          ]}
        >
          <ThemedText type="smallBold">
            {index + 1}. {lesson.title.trim() || t("courses.untitledLesson")}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
function LessonPlayback({
  id,
  progressKey,
  onSaved,
}: {
  id: number;
  progressKey: string;
  onSaved: () => Promise<void>;
}) {
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
      onSaved={onSaved}
    />
  );
}
function LessonRead({
  id,
  locale,
  retry,
  loadingLabel,
  progressKey,
  onSaved,
}: {
  id: number;
  locale: string;
  retry: () => void;
  loadingLabel: string;
  progressKey: string;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations();
  const gate = useAuthGate();
  const read = useCourseRead(
    useCallback(
      async (signal: AbortSignal) => {
        const [url, progress] = await Promise.all([
          getLessonUrl(id, locale, signal),
          readLessonProgress(progressKey),
        ]);
        try {
          const parsed = new URL(url);
          if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)
            throw new Error();
        } catch {
          throw new Error(t("courses.playError"));
        }
        return { url, progress };
      },
      [id, locale, t, progressKey]
    )
  );
  return read.error ? (
    <View style={styles.section}>
      <Failure message={read.error} retry={retry} />
      {read.unauthorized && !gate.isAuthenticated ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => gate.openLogin()}
          style={styles.lesson}
        >
          <ThemedText>{t("courses.signIn")}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  ) : read.data ? (
    <LessonVideo
      url={read.data.url}
      initial={read.data.progress}
      progressKey={progressKey}
      onSaved={onSaved}
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
  onSaved,
}: {
  url: string;
  retry: () => void;
  initial: LessonProgress | null;
  progressKey: string;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations();
  const player = useVideoPlayer(url, (instance) => {
    instance.staysActiveInBackground = false;
  });
  const saved = useEffectEvent(onSaved);
  useLayoutEffect(
    () => trackLessonProgress(player, progressKey, initial, () => saved()),
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
    gap: Spacing.three,
  },
  section: { gap: Spacing.three },
  search: { minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
  card: { padding: Spacing.three, borderRadius: 8, gap: Spacing.two, marginBottom: Spacing.three },
  cover: { width: "100%", aspectRatio: 16 / 9 },
  video: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
  lesson: { padding: Spacing.three, minHeight: 44, borderRadius: 8 },
});
