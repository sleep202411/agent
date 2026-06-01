import { IpTaxonomyPanel } from "@/components/admin/ip/taxonomy-panel";
import { fetchAdminIpTaxonomy } from "@/lib/admin-ip-commerce";
import { getAdminSession } from "@/lib/admin-session";

export default async function IpTaxonomyPage() {
  const session = await getAdminSession();
  const taxonomy = await fetchAdminIpTaxonomy();

  return (
    <IpTaxonomyPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialTaxonomy={taxonomy.data}
      initialError={taxonomy.error}
    />
  );
}
