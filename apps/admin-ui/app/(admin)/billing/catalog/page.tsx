import { BillingCatalogPanel } from "@/components/admin/billing/catalog-panel";
import { fetchAdminBillingPrices } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingCatalogPage() {
  const session = await getAdminSession();
  const prices = await fetchAdminBillingPrices();

  return (
    <BillingCatalogPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialPrices={prices.data}
      initialError={prices.error}
    />
  );
}
