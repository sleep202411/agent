import { getAdminSession } from "@/lib/admin-session";
import { RevenuePanel } from "@/components/admin/revenue/revenue-panel";
export default async function RevenuePage() {
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("creator.revenue.manage"))
    return <p role="alert">Revenue management permission is required.</p>;
  return (
    <RevenuePanel
      key={`${session.site.key}:${session.user.id}:${session.session.id}`}
      currency={session.site.key === "cn" ? "CNY" : "USD"}
    />
  );
}
