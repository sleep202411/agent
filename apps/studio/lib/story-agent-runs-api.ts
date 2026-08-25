import type { StoryAgentRunDto } from "@repo/shared/story-agent";
import { api } from "./api";

export type { StoryAgentRunDto };

/**
 * The lifecycle head for one story project/chapter — the run the assistant panel
 * shows: an in-flight `authoring`/`applying` run, a `proposed` draft awaiting
 * confirm, or the most recent terminal event. Null when the project has never
 * run the authoring agent. The workspace is carried by the api client's ambient
 * `x-fizz-workspace-id` header (the project's, set by the workspace gate).
 */
export function storyAgentRunActiveQueryKey(projectId: string, chapterId: string | null) {
  return ["story-studio", "agent-run", "active", projectId, chapterId ?? "project"] as const;
}

export function storyAgentRunByIdQueryKey(projectId: string, runId: string | null) {
  return ["story-studio", "agent-run", "by-id", projectId, runId ?? "none"] as const;
}

export function getActiveStoryAgentRun(
  projectId: string,
  chapterId: string | null,
  signal?: AbortSignal
): Promise<StoryAgentRunDto | null> {
  return api.get<StoryAgentRunDto | null>(`/aurora/story-projects/${projectId}/agent-runs/active`, {
    params: chapterId ? { chapterId } : undefined,
    signal,
  });
}

/** Resolve the immutable Story run referenced by an Agent approval. */
export function getStoryAgentRun(
  projectId: string,
  runId: string,
  signal?: AbortSignal
): Promise<StoryAgentRunDto> {
  return api.get<StoryAgentRunDto>(`/aurora/story-projects/${projectId}/agent-runs/${runId}`, {
    signal,
  });
}

/** Legacy-only failure abandonment; Agent-managed decisions use resolveApproval. */
export function cancelStoryAgentRun(projectId: string, runId: string): Promise<StoryAgentRunDto> {
  return api.post<StoryAgentRunDto>(
    `/aurora/story-projects/${projectId}/agent-runs/${runId}/cancel`,
    {}
  );
}

/** Re-arm drafting for an `authoring_failed` run without a new chat turn. */
export function retryStoryAgentRunAuthoring(
  projectId: string,
  runId: string
): Promise<StoryAgentRunDto> {
  return api.post<StoryAgentRunDto>(
    `/aurora/story-projects/${projectId}/agent-runs/${runId}/retry-authoring`,
    {}
  );
}
