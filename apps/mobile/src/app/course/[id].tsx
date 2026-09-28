import { useLocalSearchParams } from "expo-router";
import { CourseScreen } from "@/features/courses/screens";
export default function CourseRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CourseScreen id={typeof id === "string" ? id : ""} />;
}
