import { IpReviewsPanel } from "@/components/admin/ip/governance-panels";
import { fetchAdminIpOverview } from "@/lib/admin-ip-commerce";
import { getAdminSession } from "@/lib/admin-session";

export default async function IpReviewsPage() {
  const session = await getAdminSession();
  const overview = await fetchAdminIpOverview();

  return (
    <IpReviewsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      overview={overview.data}
      error={overview.error}
    />
  );
}
