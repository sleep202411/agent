import { CourseLearningPagination } from "@/components/admin/courses/course-learning-pagination";
import { CourseHomeworkPanel } from "@/components/admin/courses/course-homework-panel";
import { loadAdminHomework, loadAdminTeachingIncome } from "@/lib/admin-academy-learning";
import { requireContentPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export default async function CourseHomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  const session = await requireContentPagePermission("courses.read");
  const after = (await searchParams).after;
  const [homework, catalog, income] = await Promise.all([
    loadAdminHomework("submitted", after),
    loadAdminHomework("all"),
    loadAdminTeachingIncome(),
  ]);
  return (
    <>
      <CourseHomeworkPanel
        siteLabel={session.site.label}
        databaseLabel={session.site.databaseLabel}
        displayName={session.user.displayName}
        initialItems={homework.data?.items ?? []}
        metricItems={catalog.data?.items ?? homework.data?.items ?? []}
        summary={income.data}
        loadError={homework.error || catalog.error || income.error}
        canReview={Boolean(session.user.permissions.includes("courses.write"))}
        scope={homework.data?.scope ?? (session.user.platformUserId ? "lecturer" : "operator")}
      />
      <CourseLearningPagination
        path="/courses/homework"
        after={after}
        nextCursor={homework.data?.nextCursor}
      />
    </>
  );
}
