import { BillingComputeMemberUsagePanel } from "@/components/admin/billing/compute-member-usage-panel";
import { fetchAdminComputeMemberUsage } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingComputeMemberUsagePage() {
  const session = await getAdminSession();
  const usage = await fetchAdminComputeMemberUsage({ days: "30", workspaceKind: "all" });

  return (
    <BillingComputeMemberUsagePanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={usage.data}
      initialError={usage.error}
    />
  );
}
