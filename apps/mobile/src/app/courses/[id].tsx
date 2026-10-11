import { Stack, useLocalSearchParams } from "expo-router";
import { CourseScreen } from "@/features/courses/screens";
import { useTranslations } from "@/i18n";
export default function CourseRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("courses.title") }} />
      <CourseScreen id={typeof id === "string" ? id : ""} />
    </>
  );
}
