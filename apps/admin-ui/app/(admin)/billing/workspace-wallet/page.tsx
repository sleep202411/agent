import { BillingWorkspaceWalletPanel } from "@/components/admin/billing/workspace-wallet-panel";
import { fetchAdminBillingWorkspaces } from "@/lib/admin-billing";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingWorkspaceWalletPage() {
  const session = await getAdminSession();
  const workspaces = await fetchAdminBillingWorkspaces({ limit: "30" });

  return (
    <BillingWorkspaceWalletPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      canWrite={session?.user.permissions.includes("points.direct_grant") ?? false}
      initialRows={workspaces.data?.items ?? []}
      initialError={workspaces.error}
    />
  );
}
