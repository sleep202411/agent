"use client";

import { IconUsersGroup } from "@tabler/icons-react";
import { Skeleton } from "@/components/ui/skeleton";
import { MembersManager } from "@/app/_components/members-manager";
import { useWorkspace } from "@/app/_components/workspace-context";
import { EmptyState, PageHeader, Panel, TeamBadge } from "../_components/settings-ui";

/**
 * Team members — the full roster for the active team (add-by-account, invite
 * links, role changes, removal). Personal workspaces aren't shareable, so they
 * get an honest "create a team" empty state. Per-project sharing uses the modal.
 */
export default function MembersSettingsPage() {
  const { activeWorkspace: ws, loading } = useWorkspace();
  const canManage = ws?.role === "owner" || ws?.role === "admin";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader
        title="Members"
        badge={ws ? <TeamBadge label={ws.type === "personal" ? "Personal" : "Team"} /> : undefined}
        subtitle={
          ws && ws.type === "team"
            ? `Members of “${ws.name}” can collaborate on every project in this team.`
            : undefined
        }
      />

      {loading || !ws ? (
        <div className="space-y-2">
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ) : ws.type === "personal" ? (
        <Panel>
          <EmptyState
            icon={<IconUsersGroup className="size-5" />}
            title="Members are for teams"
            body="Create a team from the workspace switcher, then invite people to collaborate on every project in it."
          />
        </Panel>
      ) : (
        <Panel>
          <MembersManager
            scope={{ kind: "workspace", id: ws.id, name: ws.name }}
            canManage={canManage}
          />
        </Panel>
      )}
    </main>
  );
}
