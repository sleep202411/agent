"use client";

import { useCurrentUser } from "./use-user";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCertificationRoles,
  getMyCertifications,
  submitCertification,
  updateCertification,
  type Certification,
} from "@/src/services/certification";
import { useLocale } from "@/src/i18n/i18n";

export const certKeys = {
  roles: ["certification", "roles"] as const,
  rolesOf: (locale: string) => ["certification", "roles", locale] as const,
  my: ["certification", "my"] as const,
};

/** 可选认证角色列表（AI工程师、导演等） */
export function useCertificationRoles() {
  const locale = useLocale();
  return useQuery<Record<string, string>>({
    queryKey: certKeys.rolesOf(locale),
    queryFn: ({ signal }) => getCertificationRoles(signal),
    staleTime: 30 * 60 * 1000, // 30 min, rarely changes
  });
}

/** 我的认证列表 */
export function useMyCertifications() {
  const { user } = useCurrentUser();
  return useQuery<Certification[]>({
    queryKey: [...certKeys.my, user?.id ?? null],
    enabled: Boolean(user?.id),
    queryFn: ({ signal }) => getMyCertifications(signal),
  });
}

/** 提交新认证 */
export function useSubmitCertification() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: submitCertification,
    onMutate: () => ({ accountId: user?.id ?? null }),
    onSuccess: (_data, _variables, context) =>
      queryClient.invalidateQueries({ queryKey: [...certKeys.my, context?.accountId ?? null] }),
  });
}

/** 编辑/重新提交认证 */
export function useUpdateCertification() {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCertification,
    onMutate: () => ({ accountId: user?.id ?? null }),
    onSuccess: (_data, _variables, context) =>
      queryClient.invalidateQueries({ queryKey: [...certKeys.my, context?.accountId ?? null] }),
  });
}
