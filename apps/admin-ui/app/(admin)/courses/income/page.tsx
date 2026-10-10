import { CourseLearningPagination } from "@/components/admin/courses/course-learning-pagination";
import { CourseIncomePanel } from "@/components/admin/courses/course-income-panel";
import { loadAdminHomework, loadAdminTeachingIncome } from "@/lib/admin-academy-learning";
import { requireContentPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export default async function CourseIncomePage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  const session = await requireContentPagePermission("courses.read");
  const after = (await searchParams).after;
  const [income, homework] = await Promise.all([
    loadAdminTeachingIncome(),
    loadAdminHomework("all", after),
  ]);
  return (
    <>
      <CourseIncomePanel
        siteLabel={session.site.label}
        databaseLabel={session.site.databaseLabel}
        summary={income.data}
        platformUserId={session.user.platformUserId ?? null}
        items={homework.data?.items ?? []}
        loadError={income.error || homework.error}
      />
      <CourseLearningPagination
        path="/courses/income"
        after={after}
        nextCursor={homework.data?.nextCursor}
      />
    </>
  );
}
