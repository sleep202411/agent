import { createFileRoute, Outlet } from "@tanstack/react-router";
import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { AgentDialog } from "@/components/agent/agent-dialog";

export const Route = createFileRoute("/_studio")({
  component: StudioLayout,
});

function StudioLayout() {
  return (
    <div className="flex h-screen">
      <WorkspaceSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <WorkspaceHeader />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <AgentDialog />
    </div>
  );
}
