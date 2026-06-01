import { IpTitlesPanel } from "@/components/admin/ip/titles-panel";
import { fetchAdminIpTaxonomy, fetchAdminIps } from "@/lib/admin-ip-commerce";
import { getAdminSession } from "@/lib/admin-session";

export default async function IpTitlesPage() {
  const session = await getAdminSession();
  const [ips, taxonomy] = await Promise.all([fetchAdminIps(), fetchAdminIpTaxonomy()]);

  return (
    <IpTitlesPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialIps={ips.data}
      taxonomy={taxonomy.data}
      initialError={ips.error ?? taxonomy.error}
    />
  );
}
