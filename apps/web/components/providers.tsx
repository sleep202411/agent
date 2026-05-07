"use client";

import {
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { setupInterceptors } from "@/src/lib/api";
import { StoreProvider } from "@/src/store/provider";
import { useEntityEventsSession } from "@/src/lib/entity-events/use-entity-events-session";
import { AuthInterceptor } from "@/components/layout/auth-interceptor";
import { ApexRedirect } from "@/components/apex-redirect";

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

export function Providers({
  children,
  dehydratedState,
}: {
  children: React.ReactNode;
  /**
   * SSR-prefetched React Query cache. When supplied (from
   * `app/layout.tsx`), the HydrationBoundary seeds the client cache
   * before the first paint — so screens that read `useUserInfo()`
   * already see the logged-in user and don't flash the visitor state.
   */
  dehydratedState?: DehydratedState;
}) {
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

  return (
    <StoreProvider>
      <QueryClientProvider client={queryClient}>
        <HydrationBoundary state={dehydratedState}>
          <TooltipProvider>
            <ApexRedirect />
            <AuthInterceptor />
            <EntityEventsSession>{children}</EntityEventsSession>
            <Toaster position="top-center" />
          </TooltipProvider>
        </HydrationBoundary>
      </QueryClientProvider>
    </StoreProvider>
  );
}
