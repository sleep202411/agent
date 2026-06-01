import { BillingEventsPanel } from "@/components/admin/billing/events-panel";
import { fetchAdminBillingProviderEvents } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingEventsPage() {
  const session = await getAdminSession();
  const events = await fetchAdminBillingProviderEvents();

  return (
    <BillingEventsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialProviderEvents={events.data}
      initialError={events.error}
    />
  );
}
