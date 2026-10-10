import { CourseMinePanel } from "@/components/admin/courses/course-mine-panel";
import { loadAdminTeachingCourses } from "@/lib/admin-academy-learning";
import { requireContentPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export default async function CourseMinePage() {
  const session = await requireContentPagePermission("courses.read");
  const courses = await loadAdminTeachingCourses();
  return (
    <CourseMinePanel
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      items={courses.data?.items ?? []}
      loadError={courses.error}
    />
  );
}
