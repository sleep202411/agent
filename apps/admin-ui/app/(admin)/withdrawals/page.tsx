import { getAdminSession } from "@/lib/admin-session";
import { WithdrawalsPanel } from "@/components/admin/withdrawals/withdrawals-panel";
export default async function WithdrawalsPage() {
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("creator.withdrawals.manage"))
    return <p role="alert">Withdrawal management permission is required.</p>;
  return (
    <WithdrawalsPanel
      key={`${session.site.key}:${session.user.id}:${session.session.id}`}
      adminId={session.user.id}
      canTakeOver={session.user.roleKeys.some(
        (role) => role === "super_admin" || role === "master_financial_controller"
      )}
    />
  );
}
