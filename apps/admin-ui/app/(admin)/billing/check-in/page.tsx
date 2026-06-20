import { BillingCheckInPanel } from "@/components/admin/billing/check-in-panel";
import { fetchAdminCheckInConfig } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingCheckInPage() {
  const session = await getAdminSession();
  const config = await fetchAdminCheckInConfig();

  return (
    <BillingCheckInPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialConfig={config.data}
      initialError={config.error}
    />
  );
}
