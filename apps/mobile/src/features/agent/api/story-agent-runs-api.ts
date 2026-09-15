/**
 * Story authoring-run lifecycle head — same Aurora path PC Story Studio polls
 * for live activity copy (structure / screenplay / apply).
 * Paths omit `/aurora`; `api` resolves the aurora base URL.
 *
 * Typed as the activity subset only — do not import `@repo/shared/story-agent`
 * here (that module pulls the full proposal Zod graph into Metro).
 */

import { api } from "@/lib/api-client";

const AURORA = { service: "aurora" as const };

export const STORY_AUTHORING_STAGE_KEYS = [
  "foundation",
  "structure",
  "branch",
  "scene",
  "assets",
  "storyboard",
  "validate",
] as const;

export type StoryAuthoringStageKey = (typeof STORY_AUTHORING_STAGE_KEYS)[number];

export type StoryAuthoringStageProgress = {
  key: StoryAuthoringStageKey;
  status: "pending" | "running" | "done" | "failed";
};

export type StoryAgentRunDto = {
  id: string;
  status: string;
  agentOsManaged: boolean;
  authoringStages: StoryAuthoringStageProgress[] | null;
  proposal: {
    schemaVersion: string;
    title?: string;
    summary?: string;
    screenplay?: {
      title?: string;
      logline?: string;
      synopsis?: string;
      storyLanguage?: string;
      entrySceneId?: string;
      scenes?: unknown[];
      characters?: unknown[];
    };
    /** Canonical Script document shown in the review dialog (same as PC). */
    document?: {
      schemaVersion?: string;
      blocks?: unknown[];
    };
    assetPlan?: {
      assetSpecs?: { kind?: string }[];
    };
    storyboardPlan?: {
      storyboardSequences?: {
        plotNodeId?: string;
        title?: string;
        description?: string;
        durationMs?: number;
        clips?: unknown[];
      }[];
    };
  };
};

export function getActiveStoryAgentRun(
  projectId: string,
  chapterId: string | null,
  signal?: AbortSignal
): Promise<StoryAgentRunDto | null> {
  return api.get<StoryAgentRunDto | null>(
    `/story-projects/${encodeURIComponent(projectId)}/agent-runs/active`,
    {
      ...AURORA,
      params: chapterId ? { chapterId } : undefined,
      signal,
      timeout: 30_000,
    }
  );
}

export function getStoryAgentRun(
  projectId: string,
  runId: string,
  signal?: AbortSignal
): Promise<StoryAgentRunDto> {
  return api.get<StoryAgentRunDto>(
    `/story-projects/${encodeURIComponent(projectId)}/agent-runs/${encodeURIComponent(runId)}`,
    {
      ...AURORA,
      signal,
      timeout: 30_000,
    }
  );
}
