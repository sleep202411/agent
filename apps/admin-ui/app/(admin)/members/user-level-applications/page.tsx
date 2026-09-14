import { UserLevelApplicationsPanel } from "@/components/admin/user-levels/user-level-applications-panel";
import { loadAdminUserLevelApplications } from "@/lib/admin-user-level-applications";
import { loadAdminUserLevelDefinitions } from "@/lib/admin-user-levels";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function MembersUserLevelApplicationsPage() {
  const [session, applications, levels] = await Promise.all([
    getAdminSession(),
    // Default to pending — the operator queue.
    loadAdminUserLevelApplications({ status: 0 }),
    loadAdminUserLevelDefinitions(),
  ]);

  return (
    <UserLevelApplicationsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialList={applications.data}
      initialLevels={levels.data ?? []}
      initialError={applications.error ?? levels.error}
    />
  );
}
