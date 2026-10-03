"use client";

import { WorkspaceSettingsGate } from "../_components/workspace-settings-gate";

import { useAuth } from "@/app/_components/auth-provider";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "@/i18n/navigation";
import { settingsMemberProject } from "@/lib/settings-member-scope";
import { getProject } from "@/lib/collab/projects-api";
import { getStoryWorkbench } from "@/lib/story-projects-api";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { MembersManager } from "@/app/_components/members-manager";
import { useWorkspace } from "@/app/_components/workspace-context";
import { PageHeader, Panel } from "../_components/settings-ui";

export default function MembersSettingsPage() {
  const t = useTranslations("settings");
  const project = settingsMemberProject(usePathname());
  return project ? (
    <ProjectMembers key={`${project.kind}:${project.id}`} project={project} />
  ) : (
    <WorkspaceSettingsGate title={t("members")}>
      <WorkspaceMembers />
    </WorkspaceSettingsGate>
  );
}

function WorkspaceMembers() {
  const t = useTranslations("settings");
  const { activeWorkspace: ws, loading } = useWorkspace();
  const canManage = ws?.role === "owner" || ws?.role === "admin";

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader
        title={t("members")}
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
            key={ws.id}
            scope={{ kind: "workspace", id: ws.id, name: ws.name }}
            canManage={canManage}
          />
        </Panel>
      )}
    </main>
  );
}

function ProjectMembers({
  project,
}: {
  project: NonNullable<ReturnType<typeof settingsMemberProject>>;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const viewerId = user?.id == null ? null : String(user.id);
  const query = useQuery({
    queryKey: ["settings-member-project", project.kind, project.id, viewerId],
    enabled: Boolean(viewerId),
    queryFn: async ({ signal }) => {
      if (project.kind === "project") {
        const data = await getProject(project.id, signal);
        return { name: data.name, canManage: data.role === "owner" || data.role === "admin" };
      }
      const { project: data } = await getStoryWorkbench(project.id, undefined, signal);
      return { name: data.title, canManage: data.capabilities.includes("story.admin") };
    },
    retry: false,
  });
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
      <PageHeader
        title={t("projectMembers")}
        subtitle={query.data ? t("projectMembersSubtitle", { name: query.data.name }) : undefined}
      />
      <Panel>
        {query.isError ? (
          <div role="alert" className="space-y-3 text-sm">
            <p>{query.error.message}</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              {tc("retry")}
            </Button>
          </div>
        ) : query.data ? (
          <MembersManager
            scope={{ ...project, name: query.data.name }}
            canManage={query.data.canManage}
          />
        ) : (
          <Skeleton className="h-11 w-full rounded-lg" />
        )}
      </Panel>
    </main>
  );
}
