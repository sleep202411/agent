import { UserLevelsPanel } from "@/components/admin/user-levels/user-levels-panel";
import {
  loadAdminUserLevelDefinitions,
  loadAdminUserLevelRelations,
} from "@/lib/admin-user-levels";
import { requireAdminPagePermission } from "@/lib/admin-content-permission";

export const dynamic = "force-dynamic";

export default async function MembersUserLevelsPage() {
  const session = await requireAdminPagePermission("user.read");
  const [relations, levels] = await Promise.all([
    loadAdminUserLevelRelations(),
    loadAdminUserLevelDefinitions(),
  ]);

  return (
    <UserLevelsPanel
      siteLabel={session.site.label}
      databaseLabel={session.site.databaseLabel}
      initialList={relations.data}
      initialLevels={levels.data ?? []}
      initialError={relations.error ?? levels.error}
    />
  );
}
