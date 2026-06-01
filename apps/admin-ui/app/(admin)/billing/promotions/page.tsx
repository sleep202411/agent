import { BillingPromotionsPanel } from "@/components/admin/billing/promotions-panel";
import { fetchAdminBillingPromotions } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingPromotionsPage() {
  const session = await getAdminSession();
  const promotions = await fetchAdminBillingPromotions();

  return (
    <BillingPromotionsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialPromotions={promotions.data}
      initialError={promotions.error}
    />
  );
}
