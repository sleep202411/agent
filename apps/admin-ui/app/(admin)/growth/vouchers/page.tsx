import { BillingVouchersPanel } from "@/components/admin/billing/vouchers-panel";
import { fetchAdminBillingVouchers } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingVouchersPage() {
  const session = await getAdminSession();
  const vouchers = await fetchAdminBillingVouchers();

  return (
    <BillingVouchersPanel
      siteKey={session?.site.key ?? "global"}
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialVouchers={vouchers.data}
      initialError={vouchers.error}
    />
  );
}
