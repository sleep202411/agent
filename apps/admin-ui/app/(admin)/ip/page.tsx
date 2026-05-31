import { cookies } from "next/headers";
import {
  AdminIpCommercePanel,
  type AdminIpOverviewData,
  type AdminIpsData,
} from "@/components/admin/admin-ip-commerce-panel";
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

export default async function IpAdminPage() {
  const session = await getAdminSession();
  const initial = await getInitialIpData();

  return (
    <AdminIpCommercePanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialOverview={initial.overview}
      initialIps={initial.ips}
      initialError={initial.error}
    />
  );
}

async function getInitialIpData(): Promise<{
  overview: AdminIpOverviewData | null;
  ips: AdminIpsData | null;
  error: string | null;
}> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const siteKey = normalizeAdminSiteKey(cookieStore.get(ADMIN_SITE_COOKIE)?.value);
  if (!sessionToken) {
    return { overview: null, ips: null, error: "后台登录已失效，请重新登录。" };
  }

  try {
    const headers = cookieHeader(sessionToken);
    const [overviewResponse, ipsResponse] = await Promise.all([
      fetch(adminApiUrl("/ip-commerce/overview", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/ip-commerce/ips", siteKey), {
        headers,
        cache: "no-store",
      }),
    ]);
    const [overview, ips] = await Promise.all([
      parseAdminEnvelope<AdminIpOverviewData>(overviewResponse),
      parseAdminEnvelope<AdminIpsData>(ipsResponse),
    ]);
    return { overview, ips, error: null };
  } catch (error) {
    return {
      overview: null,
      ips: null,
      error:
        error instanceof Error
          ? error.message
          : `${adminSiteByKey(siteKey).label} IP 内容数据加载失败。`,
    };
  }
}
