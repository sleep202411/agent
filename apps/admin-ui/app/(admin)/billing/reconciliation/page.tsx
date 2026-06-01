import { BillingReconciliationPanel } from "@/components/admin/billing/reconciliation-panel";
import { fetchAdminBillingReconciliationRuns } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingReconciliationPage() {
  const session = await getAdminSession();
  const reconciliationRuns = await fetchAdminBillingReconciliationRuns();

  return (
    <BillingReconciliationPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialReconciliationRuns={reconciliationRuns.data}
      initialError={reconciliationRuns.error}
    />
  );
}
