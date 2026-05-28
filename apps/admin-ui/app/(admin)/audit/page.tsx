import { cookies } from "next/headers";
import { AdminAuditPanel, type AdminAuditListData } from "@/components/admin/admin-audit-panel";
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

export default async function AuditAdminPage() {
  const session = await getAdminSession();
  const { data, error } = await getInitialAudit();

  return (
    <AdminAuditPanel
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={data}
      initialError={error}
    />
  );
}

async function getInitialAudit(): Promise<{
  data: AdminAuditListData | null;
  error: string | null;
}> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const siteKey = normalizeAdminSiteKey(cookieStore.get(ADMIN_SITE_COOKIE)?.value);
  if (!sessionToken) {
    return { data: null, error: "后台登录已失效，请重新登录。" };
  }

  try {
    const response = await fetch(adminApiUrl("/audit", siteKey), {
      headers: cookieHeader(sessionToken),
      cache: "no-store",
    });
    return {
      data: await parseAdminEnvelope<AdminAuditListData>(response),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : `${adminSiteByKey(siteKey).label} 审计日志加载失败。`,
    };
  }
}
