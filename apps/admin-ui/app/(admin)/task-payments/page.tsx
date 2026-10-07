import { getAdminSession } from "@/lib/admin-session";
import { TaskPaymentsPanel } from "./task-payments-panel";
export default async function TaskPaymentsPage() {
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("creator.revenue.manage"))
    return <p role="alert">Creator revenue management permission is required.</p>;
  return <TaskPaymentsPanel key={`${session.site.key}:${session.user.id}:${session.session.id}`} />;
}
