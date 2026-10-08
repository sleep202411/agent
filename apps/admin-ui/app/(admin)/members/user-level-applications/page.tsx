import { UserLevelApplicationsPanel } from "@/components/admin/user-levels/user-level-applications-panel";
import { loadAdminUserLevelApplications } from "@/lib/admin-user-level-applications";
import { loadAdminUserLevelDefinitions } from "@/lib/admin-user-levels";
import { requireAdminPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export default async function MembersUserLevelApplicationsPage() {
  const session = await requireAdminPagePermission("user.read");
  const [applications, levels] = await Promise.all([
    // Default to pending — the operator queue.
    loadAdminUserLevelApplications({ status: 0 }),
    loadAdminUserLevelDefinitions(),
  ]);

  return (
    <UserLevelApplicationsPanel
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      initialList={applications.data}
      initialLevels={levels.data ?? []}
      initialError={applications.error ?? levels.error}
    />
  );
}
