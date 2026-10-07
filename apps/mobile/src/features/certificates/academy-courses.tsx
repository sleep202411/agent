import { useEffect, useEffectEvent, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useTranslations } from "@/i18n";
import {
  academyCourseUrl,
  fetchCertificateCourses,
  type AcademyCourses,
} from "./academy-courses-api";

export function AcademyCoursesForCertificate({ certificateId }: { certificateId: number }) {
  const locale = useLocale();
  const active = useScreenActive();
  return active ? (
    <CourseLinks key={`${certificateId}:${locale}`} certificateId={certificateId} locale={locale} />
  ) : null;
}
function CourseLinks({ certificateId, locale }: { certificateId: number; locale: string }) {
  const t = useTranslations();
  const theme = useTheme();
  const [page, setPage] = useState<AcademyCourses | null>(null);
  const [after, setAfter] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const load = useEffectEvent((controller: AbortController) => {
    setBusy(true);
    setError(undefined);
    void fetchCertificateCourses(certificateId, locale, controller.signal, after)
      .then((next) => {
        if (controller.signal.aborted) return;
        setPage((previous) => ({
          ...next,
          items: [
            ...new Map(
              [...(after ? (previous?.items ?? []) : []), ...next.items].map((item) => [
                item.courseId,
                item,
              ])
            ).values(),
          ],
        }));
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : t("academyCourses.failed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
  });
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) load(controller);
    });
    return () => controller.abort();
  }, [certificateId, locale, after, revision]);
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <ThemedText type="smallBold">{t("academyCourses.title")}</ThemedText>
      {busy ? <ActivityIndicator accessibilityLabel={t("academyCourses.loading")} /> : null}
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => setRevision((value) => value + 1)}
          >
            <ThemedText>{t("academyCourses.retry")}</ThemedText>
          </Pressable>
        </>
      ) : null}
      {page?.items.map((course) => (
        <Pressable
          key={course.courseId}
          accessibilityRole="link"
          style={{ borderRadius: 8, backgroundColor: theme.backgroundElement, padding: 12 }}
          onPress={() => {
            void WebBrowser.openBrowserAsync(academyCourseUrl(course.courseId, locale)).catch(
              (cause) =>
                setError(cause instanceof Error ? cause.message : t("academyCourses.failed"))
            );
          }}
        >
          <ThemedText>{course.title}</ThemedText>
          <ThemedText>{t("academyCourses.openWeb")}</ThemedText>
        </Pressable>
      ))}
      {!busy && !error && page && !page.items.length && !page.nextCursor ? (
        <ThemedText>{t("academyCourses.empty")}</ThemedText>
      ) : null}
      {page?.nextCursor && !error ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => setAfter(page.nextCursor ?? undefined)}
        >
          <ThemedText>{t("academyCourses.more")}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}
