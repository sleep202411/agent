import { SessionsPanel } from "@/components/admin/users/sessions-panel";
import { fetchAdminSessions } from "@/lib/admin-users";
import { getAdminSession } from "@/lib/admin-session";

export const dynamic = "force-dynamic";

export default async function UsersSessionsPage() {
  const [session, sessions] = await Promise.all([getAdminSession(), fetchAdminSessions()]);

  return (
    <SessionsPanel
      currentUserId={session?.user.id ?? ""}
      currentSessionId={session?.session.id ?? ""}
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialData={sessions.data}
      initialError={sessions.error}
    />
  );
}
