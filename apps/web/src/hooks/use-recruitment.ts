import { useCurrentUser } from "./use-user";
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
  const { user } = useCurrentUser();
  return useQuery<JobApplicant[]>({
    queryKey: [...recruitmentKeys.list, user?.id ?? null],
    enabled: Boolean(user?.id),
    queryFn: ({ signal }) => getRecruitmentList({ page: 1, pageSize: 50 }, signal),
  });
}

export function useAgreeJobApply() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (applyId: string) => agreeJobApply(applyId),
    onMutate: () => ({ accountId: user?.id ?? null }),
    onSuccess: (_data, _variables, context) =>
      qc.invalidateQueries({ queryKey: [...recruitmentKeys.list, context?.accountId ?? null] }),
  });
}

export function useRefuseJobApply() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ applyId, message }: { applyId: string; message?: string }) =>
      refuseJobApply(applyId, message),
    onMutate: () => ({ accountId: user?.id ?? null }),
    onSuccess: (_data, _variables, context) =>
      qc.invalidateQueries({ queryKey: [...recruitmentKeys.list, context?.accountId ?? null] }),
  });
}
