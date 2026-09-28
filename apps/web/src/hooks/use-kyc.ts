import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getNeedAuth, certifyInit, certifyQuery, type KycAuthStatus } from "@/src/services/kyc";
import { userKeys, useCurrentUser } from "@/src/hooks/use-user";

export const kycKeys = {
  authStatus: ["kyc", "auth-status"] as const,
};

/**
 * Backend probe: whether the current user still needs real-name verification.
 * 5-minute stale time — the status rarely changes during a session.
 */
export function useKycAuthStatus(options: { enabled?: boolean } = {}) {
  const { user } = useCurrentUser();
  return useQuery<KycAuthStatus>({
    queryKey: [...kycKeys.authStatus, user?.id ?? null],
    queryFn: ({ signal }) => getNeedAuth(signal),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(user?.id) && (options.enabled ?? true),
  });
}

/** POST /user/certify/init/web — returns certifyUrl for redirect. */
export function useCertifyInit() {
  return useMutation({ mutationFn: certifyInit });
}

/**
 * POST /user/certify/query — called after Aliyun redirects back. On success
 * invalidates auth-status + user-info so the profile badge and any gate
 * dialogs re-read fresh state.
 */
export function useCertifyQuery() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: certifyQuery,
    onMutate: () => ({ accountId: user?.id ?? null }),
    onSuccess: (_data, _variables, context) => {
      void qc.invalidateQueries({ queryKey: [...kycKeys.authStatus, context?.accountId ?? null] });
      if (!context?.accountId) return;
      void qc.invalidateQueries({
        queryKey: userKeys.info,
        predicate: (query) => {
          const current = query.state.data as { id?: string | number } | null | undefined;
          return current?.id != null && String(current.id) === context.accountId;
        },
      });
    },
  });
}
