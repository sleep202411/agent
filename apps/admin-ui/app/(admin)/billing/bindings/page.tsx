import { BillingBindingsPanel } from "@/components/admin/billing/bindings-panel";
import { fetchAdminBillingOverview, fetchAdminBillingPromotions } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingBindingsPage() {
  const session = await getAdminSession();
  const [overview, promotions] = await Promise.all([
    fetchAdminBillingOverview(),
    fetchAdminBillingPromotions(),
  ]);

  return (
    <BillingBindingsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialOverview={overview.data}
      initialPromotions={promotions.data}
      initialError={overview.error ?? promotions.error}
    />
  );
}
