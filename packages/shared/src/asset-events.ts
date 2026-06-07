/**
 * Asset events — real-time push payloads for the Assets domain.
 *
 * The Assets domain is broader than AI generation alone. It will
 * eventually cover: AI image/video jobs (across providers), user-
 * uploaded files, generated audio, project covers, and any other
 * resource that exists in a user's library. The `kind` discriminator
 * keeps event types open for extension without renaming the transport
 * (hub / group).
 *
 * Transport: Azure Web PubSub.
 *   - Hub:   `assets`
 *   - Group: `assets-user:{userId}` (one per user, covers all tabs)
 *
 * Today only `ai_job_update` exists. New event kinds get added here
 * as their producers come online.
 */

export interface AiJobUpdatePayload {
  id: string;
  type: "image" | "video";
  workspaceId?: string | null;
  projectId?: string | null;
  documentId?: string | null;
  sourceSurface?: string | null;
  modelId: string;
  status: string;
  stage: string;
  prompt: string;
  /**
   * Normalized request input — included so reload-during-flight queued
   * cards can render the correct aspect ratio (output rows don't have
   * width/height yet until the upload phase finishes).
   */
  input?: Record<string, unknown>;
  outputs: Array<{
    id: string;
    type: "image" | "video";
    url: string;
    width?: number;
    height?: number;
    mimeType?: string;
    createdAt: string;
  }>;
  error?: { code: string; userMessage: string; retryable: boolean };
  queuePosition?: number | null;
  progress?: number | null;
  estimatedWaitSeconds?: number | null;
  estimatedRunSeconds?: number | null;
  estimatedTotalSeconds?: number | null;
  etaConfidence?: "high" | "low" | "medium";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type AssetEvent = {
  kind: "ai_job_update";
  /** Full latest job view — clients can replace their cached copy. */
  job: AiJobUpdatePayload;
  /** Server ms timestamp; useful for ignoring out-of-order pushes. */
  ts: number;
};

/** Azure Web PubSub group name for a user's asset events. */
export function assetsUserGroup(userId: string): string {
  return `assets-user:${userId}`;
}

export const ASSETS_HUB = "assets";
