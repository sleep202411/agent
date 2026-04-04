import { WorkspaceSidebar } from "@/components/workspace/workspace-sidebar";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { AgentDialog } from "@/components/agent/agent-dialog";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <WorkspaceSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <WorkspaceHeader />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
      <AgentDialog />
    </div>
  );
}
