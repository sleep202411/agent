import { BillingSettlementsPanel } from "@/components/admin/billing/settlements-panel";
import { fetchAdminBillingSettlements } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingSettlementsPage() {
  const session = await getAdminSession();
  const settlements = await fetchAdminBillingSettlements();

  return (
    <BillingSettlementsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialSettlements={settlements.data}
      initialError={settlements.error}
    />
  );
}
