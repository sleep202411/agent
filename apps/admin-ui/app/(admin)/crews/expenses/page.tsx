import { getAdminSession } from "@/lib/admin-session";
import { ExpenseQueuePanel } from "@/components/admin/crews/expense-queue-panel";
export default async function ExpenseQueuePage() {
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("crew.manage"))
    return <p role="alert">Crew administration permission is required.</p>;
  return <ExpenseQueuePanel key={`${session.site.key}:${session.user.id}:${session.session.id}`} />;
}
