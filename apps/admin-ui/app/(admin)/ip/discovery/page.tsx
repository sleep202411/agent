import { IpDiscoveryPanel } from "@/components/admin/ip/discovery-panel";
import { getAdminSession } from "@/lib/admin-session";

export default async function IpDiscoveryPage() {
  const session = await getAdminSession();

  return (
    <IpDiscoveryPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
    />
  );
}
