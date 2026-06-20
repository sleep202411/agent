import { BillingCampaignsPanel } from "@/components/admin/billing/campaigns-panel";
import { fetchAdminBillingCreditCampaigns } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingCampaignsPage() {
  const session = await getAdminSession();
  const campaigns = await fetchAdminBillingCreditCampaigns();

  return (
    <BillingCampaignsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialCampaigns={campaigns.data}
      initialError={campaigns.error}
    />
  );
}
