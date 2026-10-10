import { BillingComputeProjectUsagePanel } from "@/components/admin/billing/compute-project-usage-panel";
import { fetchAdminComputeProjectUsage } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingComputeProjectUsagePage() {
  const session = await getAdminSession();
  const usage = await fetchAdminComputeProjectUsage({ days: "30", workspaceKind: "all" });

  return (
    <BillingComputeProjectUsagePanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={usage.data}
      initialError={usage.error}
    />
  );
}
