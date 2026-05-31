import { cookies } from "next/headers";
import {
  AdminIpCommercePanel,
  type AdminIpEntitlementsData,
  type AdminIpOverviewData,
  type AdminIpOrdersData,
  type AdminIpsData,
  type AdminIpTaxonomyData,
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
      initialOrders={initial.orders}
      initialEntitlements={initial.entitlements}
      initialTaxonomy={initial.taxonomy}
      initialError={initial.error}
    />
  );
}

async function getInitialIpData(): Promise<{
  overview: AdminIpOverviewData | null;
  ips: AdminIpsData | null;
  orders: AdminIpOrdersData | null;
  entitlements: AdminIpEntitlementsData | null;
  taxonomy: AdminIpTaxonomyData | null;
  error: string | null;
}> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const siteKey = normalizeAdminSiteKey(cookieStore.get(ADMIN_SITE_COOKIE)?.value);
  if (!sessionToken) {
    return {
      overview: null,
      ips: null,
      orders: null,
      entitlements: null,
      taxonomy: null,
      error: "后台登录已失效，请重新登录。",
    };
  }

  try {
    const headers = cookieHeader(sessionToken);
    const [overviewResponse, ipsResponse, ordersResponse, entitlementsResponse, taxonomyResponse] =
      await Promise.all([
        fetch(adminApiUrl("/ip-commerce/overview", siteKey), {
          headers,
          cache: "no-store",
        }),
        fetch(adminApiUrl("/ip-commerce/ips", siteKey), {
          headers,
          cache: "no-store",
        }),
        fetch(adminApiUrl("/ip-commerce/orders?limit=12", siteKey), {
          headers,
          cache: "no-store",
        }),
        fetch(adminApiUrl("/ip-commerce/entitlements?limit=12", siteKey), {
          headers,
          cache: "no-store",
        }),
        fetch(adminApiUrl("/ip-commerce/taxonomy", siteKey), {
          headers,
          cache: "no-store",
        }),
      ]);
    const [overview, ips, orders, entitlements, taxonomy] = await Promise.all([
      parseAdminEnvelope<AdminIpOverviewData>(overviewResponse),
      parseAdminEnvelope<AdminIpsData>(ipsResponse),
      parseAdminEnvelope<AdminIpOrdersData>(ordersResponse),
      parseAdminEnvelope<AdminIpEntitlementsData>(entitlementsResponse),
      parseAdminEnvelope<AdminIpTaxonomyData>(taxonomyResponse),
    ]);
    return { overview, ips, orders, entitlements, taxonomy, error: null };
  } catch (error) {
    return {
      overview: null,
      ips: null,
      orders: null,
      entitlements: null,
      taxonomy: null,
      error:
        error instanceof Error
          ? error.message
          : `${adminSiteByKey(siteKey).label} IP 内容数据加载失败。`,
    };
  }
}
