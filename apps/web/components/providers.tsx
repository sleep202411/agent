"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { setupInterceptors } from "@/src/lib/api";
import { StoreProvider } from "@/src/store/provider";
import { useIframeToken } from "@/src/hooks/use-iframe-token";
import { useEntityEventsSession } from "@/src/lib/entity-events/use-entity-events-session";

/**
 * Lives inside StoreProvider so it can hook Redux. Opens a single
 * per-user entity-events WS; touch actions fire from this one session
 * regardless of how many projects/tabs the user has open.
 *
 * Gating on `auth.user` was too strict — that slice is only populated
 * when GlobalNav runs its `fetchUser` effect (under `(site)` layout),
 * but the project editor routes don't render GlobalNav, so the user
 * never got populated and the WS never opened. Instead, open the WS
 * unconditionally; the gateway closes unauthenticated sockets with
 * a fatal code (1008) and our client won't reconnect on that.
 */
function EntityEventsSession({ children }: { children: React.ReactNode }) {
  useEntityEventsSession({ enabled: true });
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const initialized = useRef(false);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  useEffect(() => {
    if (!initialized.current) {
      setupInterceptors();
      initialized.current = true;
    }
  }, []);

  // Wait for satoken from parent window when running in iframe
  const tokenReady = useIframeToken();

  if (!tokenReady) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <StoreProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <EntityEventsSession>{children}</EntityEventsSession>
          <Toaster position="top-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </StoreProvider>
  );
}
