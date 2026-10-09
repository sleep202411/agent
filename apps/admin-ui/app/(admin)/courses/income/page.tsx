import { CourseIncomePanel } from "@/components/admin/courses/course-income-panel";
import { loadAdminTeachingIncome } from "@/lib/admin-academy-learning";
import { requireContentPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export default async function CourseIncomePage() {
  const session = await requireContentPagePermission("courses.read");
  const result = await loadAdminTeachingIncome();
  return (
    <CourseIncomePanel
      siteKey={session.site.key}
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      summary={result.data}
      loadError={result.error}
    />
  );
}
