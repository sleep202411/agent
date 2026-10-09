import { CourseHomeworkPanel } from "@/components/admin/courses/course-homework-panel";
import { loadAdminHomework } from "@/lib/admin-academy-learning";
import { requireContentPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export default async function CourseHomeworkPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  const session = await requireContentPagePermission("courses.read");
  const result = await loadAdminHomework("submitted", (await searchParams).after);
  return (
    <CourseHomeworkPanel
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      nextCursor={result.data?.nextCursor ?? null}
      initialItems={result.data?.items ?? []}
      loadError={result.error}
      canReview={Boolean(session.user.permissions.includes("courses.write"))}
      scope={result.data?.scope ?? (session.user.platformUserId ? "lecturer" : "operator")}
      platformUserId={result.data?.platformUserId ?? session.user.platformUserId ?? null}
    />
  );
}
