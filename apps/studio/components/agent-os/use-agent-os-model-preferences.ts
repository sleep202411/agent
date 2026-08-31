"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentOsApi, type AgentOsModelPreferencesUpdate } from "@/lib/agent-os/api-client";

export const agentOsModelPreferenceKeys = {
  project: (projectId: string) => ["agent-os", "model-preferences", projectId] as const,
};

export function useAgentOsModelPreferences(projectId: string) {
  return useQuery({
    queryKey: agentOsModelPreferenceKeys.project(projectId),
    queryFn: ({ signal }) => agentOsApi.getModelPreferences(projectId, signal),
    staleTime: 30_000,
  });
}

export function useUpdateAgentOsModelPreferences(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentOsModelPreferencesUpdate) =>
      agentOsApi.updateModelPreferences(projectId, input),
    onSuccess: (preferences) => {
      queryClient.setQueryData(agentOsModelPreferenceKeys.project(projectId), preferences);
    },
  });
}
