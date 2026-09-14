import { UserLevelsPanel } from "@/components/admin/user-levels/user-levels-panel";
import {
  loadAdminUserLevelDefinitions,
  loadAdminUserLevelRelations,
} from "@/lib/admin-user-levels";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function MembersUserLevelsPage() {
  const [session, relations, levels] = await Promise.all([
    getAdminSession(),
    loadAdminUserLevelRelations(),
    loadAdminUserLevelDefinitions(),
  ]);

  return (
    <UserLevelsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialList={relations.data}
      initialLevels={levels.data ?? []}
      initialError={relations.error ?? levels.error}
    />
  );
}
