import { IpOrdersPanel } from "@/components/admin/ip/commerce-panels";
import { fetchAdminIpOrders } from "@/lib/admin-ip-commerce";
import { getAdminSession } from "@/lib/admin-session";

export default async function IpCommerceOrdersPage() {
  const session = await getAdminSession();
  const orders = await fetchAdminIpOrders();

  return (
    <IpOrdersPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialOrders={orders.data}
      initialError={orders.error}
    />
  );
}
