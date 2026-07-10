import { BillingTeamWalletPanel } from "@/components/admin/billing/team-wallet-panel";
import { fetchAdminBillingWorkspaces } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingTeamWalletPage() {
  const session = await getAdminSession();
  const workspaces = await fetchAdminBillingWorkspaces({ type: "team", limit: "30" });

  return (
    <BillingTeamWalletPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      canWrite={session?.user.permissions.includes("billing.write") ?? false}
      initialRows={workspaces.data?.items ?? []}
      initialError={workspaces.error}
    />
  );
}
