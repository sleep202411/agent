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
import { ConversationsProvider } from "@/src/lib/conversations/provider";
import { AuthInterceptor } from "@/components/layout/auth-interceptor";
import { TaskAccountBoundary } from "@/components/workspace/task-account-boundary";
import { AuthDialogProvider } from "@/components/auth/auth-dialog-provider";

/**
 * Lives inside StoreProvider so it can hook Redux. Opens a single
 * per-user entity-events WS; touch actions fire from this one session
 * regardless of how many projects/tabs the user has open.
 *
 * The hook follows the current React Query account: anonymous views do
 * not open a socket, and login/account replacement starts a new session.
 * Server-side authentication and fatal-close handling remain authoritative.
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
            {/* AuthDialogProvider owns the app's one sign-in dialog and
                must sit ABOVE AuthInterceptor — the 401 handler opens the
                dialog in place instead of navigating to /login. */}
            <AuthDialogProvider>
              <AuthInterceptor />
              <TaskAccountBoundary />
              <EntityEventsSession>
                <ConversationsProvider>{children}</ConversationsProvider>
              </EntityEventsSession>
              <Toaster position="top-center" />
            </AuthDialogProvider>
          </TooltipProvider>
        </HydrationBoundary>
      </QueryClientProvider>
    </StoreProvider>
  );
}
