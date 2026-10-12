import { headers } from "next/headers";
import { AuthGate } from "@/components/layout/auth-gate";
import { GlobalNav } from "@/components/layout/global-nav";
import { CrewSectionNavigation } from "@/app/(site)/crews/_components/crew-section-navigation";

/** Deep-linked crew workspaces retain the same navigation as My Crews. */
export default async function CrewWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const embedded = ((await headers()).get("user-agent") ?? "").includes("FizzDragonApp");
  return (
    <AuthGate>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
        {!embedded && <GlobalNav />}
        <main className={`flex min-h-0 flex-1 flex-col ${embedded ? "" : "pt-24"}`}>
          {!embedded && (
            <div className="shrink-0 px-4 sm:px-6">
              <CrewSectionNavigation active="mine" sticky={false} />
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </main>
      </div>
    </AuthGate>
  );
}
