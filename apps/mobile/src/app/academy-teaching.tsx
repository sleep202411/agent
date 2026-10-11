import { Stack } from "expo-router";
import { TeachingScreen } from "@/features/courses/teaching";
import { useTranslations } from "@/i18n";
export default function AcademyTeachingRoute() {
  const t = useTranslations();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t("academyLearning.teacherWorkspace") }} />
      <TeachingScreen />
    </>
  );
}
