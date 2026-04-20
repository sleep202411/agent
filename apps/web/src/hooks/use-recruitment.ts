import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  agreeJobApply,
  getRecruitmentList,
  refuseJobApply,
  type JobApplicant,
} from "@/src/services/recruitment";

export const recruitmentKeys = {
  list: ["recruitment", "list"] as const,
};

export function useRecruitmentList() {
  return useQuery<JobApplicant[]>({
    queryKey: recruitmentKeys.list,
    queryFn: () => getRecruitmentList({ page: 1, pageSize: 50 }),
  });
}

export function useAgreeJobApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applyId: string) => agreeJobApply(applyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: recruitmentKeys.list }),
  });
}

export function useRefuseJobApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ applyId, message }: { applyId: string; message?: string }) =>
      refuseJobApply(applyId, message),
    onSuccess: () => qc.invalidateQueries({ queryKey: recruitmentKeys.list }),
  });
}
