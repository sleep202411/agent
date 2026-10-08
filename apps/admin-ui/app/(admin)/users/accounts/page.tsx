import { cookies } from "next/headers";
import {
  AdminUsersPanel,
  type AdminRoleOption,
  type AdminUsersListData,
} from "@/components/admin/admin-users-panel";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { getAdminSession } from "@/lib/admin-session";
import { currentAdminSite } from "@/lib/admin-sites";
import { displayRoleName } from "@/components/admin/users/permission-tree";
import { fetchAdminRoles } from "@/lib/admin-users";

export const dynamic = "force-dynamic";

export default async function UsersAccountsPage() {
  const session = await getAdminSession();
  const [{ data, error }, roles] = await Promise.all([getInitialUsers(), fetchAdminRoles()]);
  const assignableRoles: AdminRoleOption[] = (roles.data?.roles ?? [])
    .filter((role) => role.assignable !== false)
    .map((role) => ({ value: role.key, label: displayRoleName(role) }));

  return (
    <AdminUsersPanel
      currentUserId={session?.user.id ?? ""}
      siteLabel={session?.site.label ?? "当前站点"}
      siteDomain={session?.site.domain ?? ""}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={data}
      initialError={error}
      assignableRoles={assignableRoles}
    />
  );
}

async function getInitialUsers(): Promise<{
  data: AdminUsersListData | null;
  error: string | null;
}> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const headers = adminAuthHeaders(sessionToken);
  if (!headers) {
    return { data: null, error: "后台登录已失效，请重新登录。" };
  }

  try {
    const response = await fetch(adminApiUrl("/users"), {
      headers,
      cache: "no-store",
    });
    return {
      data: await parseAdminEnvelope<AdminUsersListData>(response),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error ? error.message : `${currentAdminSite().label} 管理员列表加载失败。`,
    };
  }
}
