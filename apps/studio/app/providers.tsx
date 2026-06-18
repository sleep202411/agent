"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/app/_components/auth-provider";
import { WorkspaceProvider } from "@/app/_components/workspace-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })
  );
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        {/* App-wide so the active workspace (and its compute pot) is known on
            every surface — including the canvas chrome, which lives outside the
            studio/settings layouts. */}
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
