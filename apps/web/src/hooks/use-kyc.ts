import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getNeedAuth, certifyInit, certifyQuery, type KycAuthStatus } from "@/src/services/kyc";
import { userKeys } from "@/src/hooks/use-user";

export const kycKeys = {
  authStatus: ["kyc", "auth-status"] as const,
};

/**
 * Backend probe: whether the current user still needs real-name verification.
 * 5-minute stale time — the status rarely changes during a session.
 */
export function useKycAuthStatus(options: { enabled?: boolean } = {}) {
  return useQuery<KycAuthStatus>({
    queryKey: kycKeys.authStatus,
    queryFn: getNeedAuth,
    staleTime: 5 * 60 * 1000,
    enabled: options.enabled ?? true,
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: certifyQuery,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: kycKeys.authStatus });
      qc.invalidateQueries({ queryKey: userKeys.info });
    },
  });
}
