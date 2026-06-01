import { BillingRefundsPanel } from "@/components/admin/billing/refunds-panel";
import { fetchAdminBillingRefunds } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingRefundsPage() {
  const session = await getAdminSession();
  const refunds = await fetchAdminBillingRefunds();

  return (
    <BillingRefundsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialRefunds={refunds.data}
      initialError={refunds.error}
    />
  );
}
