import { AgentUsersPanel } from "@/components/admin/agent-users/agent-users-panel";
import { loadAdminAgentUsers } from "@/lib/admin-agent-users";
import { currentAdminSite } from "@/lib/admin-sites";

export default async function AgentUsersPage() {
  const [initialData, site] = await Promise.all([loadAdminAgentUsers(), currentAdminSite()]);
  return (
    <AgentUsersPanel
      siteLabel={site.label}
      databaseLabel={site.databaseLabel}
      initialData={initialData}
    />
  );
}
