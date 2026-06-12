import { BillingMembershipsPanel } from "@/components/admin/billing/memberships-panel";
import { fetchAdminBillingMembershipPlans } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingMembershipsPage() {
  const session = await getAdminSession();
  const plans = await fetchAdminBillingMembershipPlans();

  return (
    <BillingMembershipsPanel
      siteKey={session?.site.key ?? "global"}
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialPlans={plans.data}
      initialError={plans.error}
    />
  );
}
