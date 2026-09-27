import { getAdminSession } from "@/lib/admin-session";
import { TaskTemplatesPanel } from "@/components/admin/crews/task-templates-panel";

export default async function TaskTemplatesPage() {
  const session = await getAdminSession();
  if (!session?.user.permissions.includes("crew.manage")) {
    return <p role="alert">Crew administration permission is required.</p>;
  }

  return (
    <TaskTemplatesPanel key={`${session.site.key}:${session.user.id}:${session.session.id}`} />
  );
}
