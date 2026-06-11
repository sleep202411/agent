"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { localizePath } from "@/src/i18n/locale-url";
import { useProjects } from "../../_hooks/use-project";
import { CreateProjectDialog } from "../_components/create-project-dialog";
import { FizzStudioShell, useFizzStudioWorkspace } from "../_components/fizzstudio-shell";
import { AllProjectsSurface } from "../_components/project-sections";

export default function FizzStudioProjectsPage() {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const workspaceState = useFizzStudioWorkspace();
  const { currentLocale, isWorkspaceLoading, workspaceId } = workspaceState;
  const { data: projects = [], isLoading: loadingProjects } = useProjects(workspaceId);

  return (
    <FizzStudioShell
      className="overflow-x-hidden bg-[#0d0d0e] pb-16"
      headerVariant="enterprise"
      mainClassName="max-w-none px-4 pt-8 sm:px-6 lg:px-12 xl:px-[60px] 2xl:px-[136px]"
      sidebarVariant="enterprise"
      workspaceState={workspaceState}
    >
      <AllProjectsSurface
        isLoading={isWorkspaceLoading || loadingProjects}
        onCreateProject={() => setCreateOpen(true)}
        projects={projects}
        workspaceReady={Boolean(workspaceId)}
      />

      {workspaceId && (
        <CreateProjectDialog
          workspaceId={workspaceId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(projectId) => {
            router.push(localizePath(`/fizzstudio/projects/${projectId}`, currentLocale));
          }}
        />
      )}
    </FizzStudioShell>
  );
}
