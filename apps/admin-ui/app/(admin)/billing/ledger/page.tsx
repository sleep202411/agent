import { BillingLedgerPanel } from "@/components/admin/billing/ledger-panel";
import {
  fetchAdminBillingLedgerJournals,
  fetchAdminBillingLedgerOverview,
} from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingLedgerPage() {
  const session = await getAdminSession();
  const [ledgerOverview, ledgerJournals] = await Promise.all([
    fetchAdminBillingLedgerOverview(),
    fetchAdminBillingLedgerJournals(),
  ]);

  return (
    <BillingLedgerPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialLedgerOverview={ledgerOverview.data}
      initialLedgerJournals={ledgerJournals.data}
      initialError={ledgerOverview.error ?? ledgerJournals.error}
    />
  );
}
