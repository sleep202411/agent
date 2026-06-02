import { IpRevenuePanel } from "@/components/admin/ip/revenue-panel";
import { fetchAdminIpCommerceSettings, fetchAdminRevenueEntries } from "@/lib/admin-ip-commerce";
import { getAdminSession } from "@/lib/admin-session";

export default async function IpCommerceRevenuePage() {
  const session = await getAdminSession();
  const [settings, entries] = await Promise.all([
    fetchAdminIpCommerceSettings(),
    fetchAdminRevenueEntries(),
  ]);

  return (
    <IpRevenuePanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialSettings={settings.data}
      initialEntries={entries.data}
      initialError={settings.error ?? entries.error}
    />
  );
}
