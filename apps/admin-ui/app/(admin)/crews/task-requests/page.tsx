import { getAdminSession } from "@/lib/admin-session";
import { TaskRequestsPanel } from "@/components/admin/crews/task-requests-panel";
export default async function TaskRequestsPage() {
  const session = await getAdminSession();
  if (!session) return <p role="alert">Sign in to review task requests.</p>;
  return <TaskRequestsPanel key={`${session.site.key}:${session.user.id}:${session.session.id}`} />;
}
