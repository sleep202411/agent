import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCertificationRoles,
  getMyCertifications,
  submitCertification,
  updateCertification,
  type Certification,
} from "@/src/services/certification";

export const certKeys = {
  roles: ["certification", "roles"] as const,
  my: ["certification", "my"] as const,
};

/** 可选认证角色列表（AI工程师、导演等） */
export function useCertificationRoles() {
  return useQuery<Record<string, string>>({
    queryKey: certKeys.roles,
    queryFn: getCertificationRoles,
    staleTime: 30 * 60 * 1000, // 30 min, rarely changes
  });
}

/** 我的认证列表 */
export function useMyCertifications() {
  return useQuery<Certification[]>({
    queryKey: certKeys.my,
    queryFn: getMyCertifications,
  });
}

/** 提交新认证 */
export function useSubmitCertification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: submitCertification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certKeys.my });
    },
  });
}

/** 编辑/重新提交认证 */
export function useUpdateCertification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCertification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: certKeys.my });
    },
  });
}
