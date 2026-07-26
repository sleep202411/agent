"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { MembersManager } from "@/app/_components/members-manager";
import { useWorkspace } from "@/app/_components/workspace-context";
import { PageHeader, Panel, TeamBadge } from "../_components/settings-ui";

/**
 * Workspace members — the full roster for the active workspace (add-by-account,
 * invite links, role changes, removal). Personal workspaces get the same roster:
 * the server's seat policy, not the workspace type, decides how many people fit,
 * so hiding it here would only make that policy unreachable. Per-project sharing
 * uses the modal.
 */
export default function MembersSettingsPage() {
  const t = useTranslations("settings");
  const { activeWorkspace: ws, loading } = useWorkspace();
  const canManage = ws?.role === "owner" || ws?.role === "admin";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader
        title={t("members")}
        badge={
          ws ? <TeamBadge label={ws.type === "personal" ? t("personal") : t("team")} /> : undefined
        }
        subtitle={ws ? t("membersSubtitle", { name: ws.name }) : undefined}
      />

      {loading || !ws ? (
        <div className="space-y-2">
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
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
