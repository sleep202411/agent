"use client";

import { useQuery } from "@tanstack/react-query";
import { crewApi } from "./api";

export interface CrewExpenseSummary {
  taskRewardsByCurrency: Record<string, string>;
  reimbursementsByCurrency: Record<string, string>;
  totalByCurrency: Record<string, string>;
}

export function useCrewExpensesSummary(crewId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["crew-expenses-summary", crewId],
    queryFn: () =>
      crewApi.get<CrewExpenseSummary>(
        `/crews/${encodeURIComponent(crewId)}/expense-drafts/summary`
      ),
    enabled: enabled && Boolean(crewId),
  });
}
