import { useCallback } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { getCourseCertificate } from "./api";
import { useCourseRead } from "./use-course-read";

export function CourseCertificate({ courseId }: { courseId: string }) {
  const t = useTranslations();
  const read = useCourseRead(
    useCallback((signal: AbortSignal) => getCourseCertificate(courseId, signal), [courseId])
  );
  return (
    <View style={{ gap: 8, paddingVertical: 12 }}>
      <ThemedText type="smallBold">{t("courses.skillCertificate")}</ThemedText>
      {read.error ? (
        <>
          <ThemedText accessibilityRole="alert">{read.error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={read.retry}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText>{t("courses.certificateRetry")}</ThemedText>
          </Pressable>
        </>
      ) : !read.data ? (
        <ActivityIndicator accessibilityLabel={t("courses.certificateLoading")} />
      ) : read.data.certificate ? (
        <>
          <ThemedText>{read.data.certificate.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t("courses.certificateApproval")}
          </ThemedText>
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {t("courses.certificateUnassigned")}
        </ThemedText>
      )}
    </View>
  );
}
