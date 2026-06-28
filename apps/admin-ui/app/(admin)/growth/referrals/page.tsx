import { ReferralsPanel } from "@/components/admin/growth/referrals-panel";
import { fetchAdminReferralsProgram } from "@/lib/admin-referrals";
import { getAdminSession } from "@/lib/admin-session";

export default async function GrowthReferralsPage() {
  const session = await getAdminSession();
  const program = await fetchAdminReferralsProgram();

  return (
    <ReferralsPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialConfig={program.data}
      initialError={program.error}
    />
  );
}
