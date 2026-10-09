"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { crewApi } from "./api";
export interface ComputeRequest {
  id: string;
  taskId: string;
  taskTitle: string;
  userId: string;
  points: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  decidedByAdminId: string | null;
  decidedByUserId: string | null;
  decisionNote: string | null;
  createdAt: string;
}
export interface ComputeRequestsPage {
  isOwner: boolean;
  items: ComputeRequest[];
  nextCursor: string | null;
  tasks: { id: string; title: string; number: number }[];
  totals: Partial<Record<ComputeRequest["status"], number>>;
  consumedPoints: string;
}
export function useComputeRequests(crewId: string, cursor?: string) {
  const { user } = useCurrentUser();
  return useQuery({
    enabled: Boolean(user?.id),
    queryKey: ["crew-compute-requests", crewId, user?.id, cursor],
    queryFn: () =>
      crewApi.get<ComputeRequestsPage>(
        `/crews/${encodeURIComponent(crewId)}/compute-requests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`
      ),
    refetchInterval: 15000,
  });
}
export function useComputeRequestAction(crewId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: {
      beneficiaryUserId?: string;
      taskId: string;
      points: number;
      remainingWorkload: number;
      workloadUnit: "minutes" | "hours" | "days" | "person_days" | "percent";
      reason: string;
      requestKey: string;
    }) => crewApi.post(`/crews/${encodeURIComponent(crewId)}/compute-requests`, { body: action }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["crew-compute-requests", crewId] }),
  });
}

export function useComputeWorkspaceSetup(crewId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      crewApi.post(`/crews/${encodeURIComponent(crewId)}/compute-requests/workspace`, { body: {} }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["crew-compute-requests", crewId] }),
  });
}
