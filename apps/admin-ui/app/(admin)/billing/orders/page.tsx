import { BillingOrdersPanel } from "@/components/admin/billing/orders-panel";
import { fetchAdminBillingOrders } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingOrdersPage() {
  const session = await getAdminSession();
  const orders = await fetchAdminBillingOrders();

  return (
    <BillingOrdersPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialOrders={orders.data}
      initialError={orders.error}
    />
  );
}
