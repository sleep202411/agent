"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMyEntitlement, type MyEntitlement } from "@/lib/billing";
import { getAssetsRealtimeKernel } from "@/lib/canvas-authoring/assets-realtime-kernel";
import { useAuth } from "./auth-provider";
import { useActiveWorkspaceId } from "./workspace-context";

export const myEntitlementQueryKey = (userId: string | null, workspaceId: string | null) =>
  ["billing", "my-entitlement", userId ?? "anonymous", workspaceId ?? "personal"] as const;

interface EntitlementContextValue {
  data: MyEntitlement | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  retry: () => void;
  error: Error | null;
  queryKey: ReturnType<typeof myEntitlementQueryKey>;
}

const EntitlementContext = createContext<EntitlementContextValue | null>(null);

/**
 * App-wide entitlement truth for every membership surface. The account menu,
 * header, settings and feature gates must all consume this same query so an API
 * error can never silently masquerade as the Free plan.
 */
export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const userId = user?.id == null ? null : String(user.id);
  const queryKey = useMemo(() => myEntitlementQueryKey(userId, workspaceId), [userId, workspaceId]);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getMyEntitlement(workspaceId, signal),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!userId) return;
    const subscription = getAssetsRealtimeKernel({
      workspaceId: workspaceId ?? undefined,
    }).subscribe({
      onEvent: (event) => {
        if (event.kind === "entitlement_changed") {
          void queryClient.invalidateQueries({ queryKey });
        }
      },
    });
    return () => subscription.close();
  }, [queryClient, queryKey, userId, workspaceId]);

  const refetch = query.refetch;
  const value = useMemo<EntitlementContextValue>(
    () => ({
      data: query.data,
      isLoading: query.isLoading,
      isError: query.isError,
      isFetching: query.isFetching,
      retry: () => {
        void refetch();
      },
      error: query.error,
      queryKey,
    }),
    [query.data, query.error, query.isError, query.isLoading, query.isFetching, refetch, queryKey]
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useMyEntitlement(): EntitlementContextValue {
  const value = useContext(EntitlementContext);
  if (!value) throw new Error("useMyEntitlement must be used within EntitlementProvider");
  return value;
}

export function formatEntitlementPlanName(planKey: string): string {
  return planKey.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
