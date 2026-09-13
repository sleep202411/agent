"use client";

import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createStudioQueryClient } from "@/lib/query-client";
import { AuthProvider } from "@/app/_components/auth-provider";
import { EntitlementProvider } from "@/app/_components/entitlement-context";
import { WorkspaceProvider } from "@/app/_components/workspace-context";
import { StudioSidebarProvider } from "@/app/_components/studio-sidebar-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(createStudioQueryClient);
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        {/* App-wide so the active workspace (and its compute pot) is known on
            every surface — including the canvas chrome, which lives outside the
            studio/settings layouts. */}
        <WorkspaceProvider>
          <EntitlementProvider>
            <StudioSidebarProvider>{children}</StudioSidebarProvider>
          </EntitlementProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
