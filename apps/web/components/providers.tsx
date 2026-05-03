"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { setupInterceptors } from "@/src/lib/api";
import { StoreProvider } from "@/src/store/provider";
import { useIframeToken } from "@/src/hooks/use-iframe-token";
import { useEntityEventsSession } from "@/src/lib/entity-events/use-entity-events-session";
import { AuthInterceptor } from "@/components/layout/auth-interceptor";

/**
 * Lives inside StoreProvider so it can hook Redux. Opens a single
 * per-user entity-events WS; touch actions fire from this one session
 * regardless of how many projects/tabs the user has open.
 *
 * Open the WS unconditionally; the gateway closes unauthenticated
 * sockets with a fatal code (1008) and our client won't reconnect
 * on that. (Historical note: an earlier version gated this on a
 * Redux `auth.user` slice that's been removed in favor of RQ —
 * unconditional open + server-side reject is simpler anyway.)
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
          <AuthInterceptor />
          <EntityEventsSession>{children}</EntityEventsSession>
          <Toaster position="top-center" />
        </TooltipProvider>
      </QueryClientProvider>
    </StoreProvider>
  );
}
