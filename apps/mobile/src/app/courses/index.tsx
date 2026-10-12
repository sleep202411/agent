import { Stack } from "expo-router";
import { CoursesScreen } from "@/features/courses/screens";
import { useTranslations } from "@/i18n";
export default function CoursesRoute() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("courses.title") }} />
      <CoursesScreen />
    </>
  );
}
