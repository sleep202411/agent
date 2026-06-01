import { BillingProvidersPanel } from "@/components/admin/billing/providers-panel";
import { fetchAdminBillingOverview } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingProvidersPage() {
  const session = await getAdminSession();
  const overview = await fetchAdminBillingOverview();

  return (
    <BillingProvidersPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialOverview={overview.data}
      initialError={overview.error}
    />
  );
}
