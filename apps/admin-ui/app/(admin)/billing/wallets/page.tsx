import { BillingWalletsPanel } from "@/components/admin/billing/wallets-panel";
import { fetchAdminBillingOverview } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingWalletsPage() {
  const session = await getAdminSession();
  const overview = await fetchAdminBillingOverview();

  return (
    <BillingWalletsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialOverview={overview.data}
      initialError={overview.error}
    />
  );
}
