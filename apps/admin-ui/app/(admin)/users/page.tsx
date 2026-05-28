import { cookies } from "next/headers";
import { AdminUsersPanel, type AdminUsersListData } from "@/components/admin/admin-users-panel";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SITE_COOKIE,
  adminApiUrl,
  adminSiteByKey,
  cookieHeader,
  normalizeAdminSiteKey,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { getAdminSession } from "@/lib/admin-session";

export default async function UsersAdminPage() {
  const session = await getAdminSession();
  const { data, error } = await getInitialUsers();

  return (
    <AdminUsersPanel
      currentUserId={session?.user.id ?? ""}
      siteLabel={session?.site.label ?? "当前站点"}
      siteDomain={session?.site.domain ?? ""}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={data}
      initialError={error}
    />
  );
}

async function getInitialUsers(): Promise<{
  data: AdminUsersListData | null;
  error: string | null;
}> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const siteKey = normalizeAdminSiteKey(cookieStore.get(ADMIN_SITE_COOKIE)?.value);
  if (!sessionToken) {
    return { data: null, error: "后台登录已失效，请重新登录。" };
  }

  try {
    const response = await fetch(adminApiUrl("/users", siteKey), {
      headers: cookieHeader(sessionToken),
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
        error instanceof Error
          ? error.message
          : `${adminSiteByKey(siteKey).label} 管理员列表加载失败。`,
    };
  }
}
