"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  cancelStoryAgentRun,
  getActiveStoryAgentRun,
  getStoryAgentRun,
  retryStoryAgentRunAuthoring,
  storyAgentRunActiveQueryKey,
  storyAgentRunByIdQueryKey,
  type StoryAgentRunDto,
} from "@/lib/story-agent-runs-api";

/**
 * Loads the exact immutable Story run named by an Agent approval. This must
 * not follow the currently selected chapter's lifecycle head: users may
 * switch chapters while an earlier chapter is waiting for a decision.
 */
export function useStoryAuthoringRunById(projectId: string, runId: string | null) {
  const query = useQuery({
    queryKey: storyAgentRunByIdQueryKey(projectId, runId),
    queryFn: ({ signal }) => getStoryAgentRun(projectId, runId!, signal),
    enabled: Boolean(runId),
    staleTime: 0,
  });

  return {
    run: query.data ?? null,
    isLoading: Boolean(runId) && query.isLoading,
    refresh: query.refetch,
  };
}

/**
 * Tracks the story project's authoring run for the assistant panel: polls the
 * lifecycle head while a run is in flight (`authoring`/`applying`), stops once
 * it settles, and exposes only the legacy failed-run cancel/retry controls.
 * Proposal decisions belong to Agent OS approval, never this Story API hook.
 * When an apply settles
 * (`succeeded`) the draft changed, so the canvas's story-studio queries are
 * refreshed once — excluding this run query so the refresh cannot loop.
 */
export function useStoryAuthoringRun(projectId: string, chapterId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = storyAgentRunActiveQueryKey(projectId, chapterId);

  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getActiveStoryAgentRun(projectId, chapterId, signal),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status === "authoring" || status === "applying" ? 1500 : false;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  const run = query.data ?? null;

  const invalidatedRunId = useRef<string | null>(null);
  useEffect(() => {
    if (run?.status !== "succeeded" || invalidatedRunId.current === run.id) return;
    invalidatedRunId.current = run.id;
    void queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "story-studio" && q.queryKey[1] !== "agent-run",
    });
  }, [run?.status, run?.id, queryClient]);

  const patch = (next: StoryAgentRunDto) => queryClient.setQueryData(queryKey, next);
  const onError = (error: unknown) => {
    toast.error(error instanceof Error ? error.message : String(error));
    void queryClient.invalidateQueries({ queryKey });
  };

  const cancel = useMutation({
    mutationFn: (runId: string) => cancelStoryAgentRun(projectId, runId),
    onSuccess: patch,
    onError,
  });
  const retry = useMutation({
    mutationFn: (runId: string) => retryStoryAgentRunAuthoring(projectId, runId),
    onSuccess: patch,
    onError,
  });

  return {
    run,
    isLoading: query.isLoading,
    refresh: query.refetch,
    cancel,
    retry,
  };
}
