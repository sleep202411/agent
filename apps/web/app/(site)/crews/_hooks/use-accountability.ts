"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";

export interface Commitment {
  id: string;
  taskId: string;
  assignmentId: string;
  userId: string;
  status: "accepted" | "at_risk" | "withdrawn";
  promisedDueAt: string | null;
  acceptedAt: string | null;
  reason: string;
  releasedAt: string | null;
  handoverNote: string | null;
  currentAssignment?: boolean;
  overdue?: boolean;
  deadlineChanged?: boolean;
  task?: {
    title: string;
    number: number;
    submittedAt: string | null;
    approvedAt: string | null;
    deletedAt: string | null;
    workflowState: { semantic: string };
  };
}
export interface Participation {
  id: string;
  userId: string;
  withdrawalAt: string | null;
  withdrawalReason: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  communityPoints: number;
  awardedAt: string | null;
}
export interface PeerFeedback {
  id: string;
  authorUserId: string;
  subjectUserId: string;
  rating: number;
  comment: string;
  response: string | null;
  createdAt: string;
}
export interface Accountability {
  page: number;
  hasMore: boolean;
  completed: boolean;
  canManage: boolean;
  canAward: boolean;
  rewardPoints: number | null;
  rewardExpiryDays: number;
  participants: Participation[];
  feedback: PeerFeedback[];
  commitments: Commitment[];
  reliability: {
    userId: string;
    accepted: number;
    completed: number;
    measured: number;
    scheduleChanges: number;
    onTime: number;
    withdrawn: number;
    declined: number;
    atRisk: number;
    overdue: number;
  }[];
}
export function useTaskCommitments(taskId: string) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["crew", "commitments", taskId, user?.id ?? null],
    enabled: !!user?.id && !!taskId,
    queryFn: () =>
      crewApi.get<{ records: Commitment[] }>(
        `/crew-tasks/${encodeURIComponent(taskId)}/commitments`
      ),
    refetchInterval: 15000,
  });
}
export function useAccountability(crewId: string, page: number) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["crew", "accountability", crewId, page, user?.id ?? null],
    enabled: !!user?.id && !!crewId,
    queryFn: () =>
      crewApi.get<Accountability>(`/crews/${encodeURIComponent(crewId)}/accountability`, {
        query: { page },
      }),
    refetchInterval: 15000,
  });
}
export function useAccountabilityAction() {
  const { user } = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    onMutate: () => ({ accountUserId: user?.id ?? null }),
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) =>
      crewApi.post<unknown>(path, { body }),
    onSettled: (_data, _error, _variables, origin) => {
      if (!origin?.accountUserId) return;
      return qc.invalidateQueries({
        queryKey: ["crew"],
        predicate: (query) => {
          if (["commitments", "accountability"].includes(String(query.queryKey[1]))) {
            return query.queryKey.at(-1) === origin.accountUserId;
          }
          // develop's existing Crew queries are not account-suffixed. Refresh
          // them only if the initiating account is still the current session.
          const current = qc.getQueryData<{ id?: string | number }>(["user", "info"]);
          return current?.id != null && String(current.id) === origin.accountUserId;
        },
      });
    },
  });
}
