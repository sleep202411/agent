import { RolesPanel } from "@/components/admin/users/roles-panel";
import { fetchAdminRoles } from "@/lib/admin-users";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function UsersRolesPage() {
  const [session, roles] = await Promise.all([getAdminSession(), fetchAdminRoles()]);

  return (
    <RolesPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={roles.data}
      initialError={roles.error}
    />
  );
}
