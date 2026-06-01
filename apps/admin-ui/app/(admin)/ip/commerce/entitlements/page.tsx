import { IpEntitlementsPanel } from "@/components/admin/ip/commerce-panels";
import { fetchAdminIpEntitlements, fetchAdminIps } from "@/lib/admin-ip-commerce";
import { getAdminSession } from "@/lib/admin-session";

export default async function IpCommerceEntitlementsPage() {
  const session = await getAdminSession();
  const [entitlements, ips] = await Promise.all([fetchAdminIpEntitlements(), fetchAdminIps()]);

  return (
    <IpEntitlementsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialEntitlements={entitlements.data}
      ips={ips.data}
      initialError={entitlements.error ?? ips.error}
    />
  );
}
