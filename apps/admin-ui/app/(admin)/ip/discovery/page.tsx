import { IpDiscoveryPanel } from "@/components/admin/ip/discovery-panel";
import { fetchAdminIpDiscovery } from "@/lib/admin-ip-commerce";
import { getAdminSession } from "@/lib/admin-session";

export default async function IpDiscoveryPage() {
  const [session, discovery] = await Promise.all([getAdminSession(), fetchAdminIpDiscovery()]);

  return (
    <IpDiscoveryPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={discovery.data}
      initialError={discovery.error}
    />
  );
}
