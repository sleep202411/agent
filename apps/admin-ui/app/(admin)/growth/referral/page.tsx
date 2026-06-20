import { BillingReferralPanel } from "@/components/admin/billing/referral-panel";
import { fetchAdminReferralConfig, fetchAdminReferrals } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingReferralPage() {
  const session = await getAdminSession();
  const [config, referrals] = await Promise.all([
    fetchAdminReferralConfig(),
    fetchAdminReferrals(),
  ]);

  return (
    <BillingReferralPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialConfig={config.data}
      initialReferrals={referrals.data}
      initialError={config.error ?? referrals.error}
    />
  );
}
