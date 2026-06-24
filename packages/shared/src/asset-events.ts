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
 * Event kinds are durable product events, not provider callbacks.
 * Clients should merge them idempotently by the entity `updatedAt` / `ts`.
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
    assetId?: string;
    type: "image" | "video";
    url: string;
    accessUrl?: string;
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

/**
 * Realtime-plane envelope fields (P3, docs/studio-realtime-architecture.md §3),
 * stamped onto every event the generalized outbox publishes. Optional on the
 * wire for backward-compat: legacy in-flight events omit them and old clients
 * ignore them. New clients use `seq` for gap detection + `/replay` catch-up and
 * `eventId` for idempotent dedup.
 */
export interface RealtimeEnvelope {
  /** Channel this event was published on, e.g. `job:<id>`, `wallet:user:<id>`. */
  channel?: string;
  /** Per-channel monotonic sequence. */
  seq?: number;
  /** Globally-unique event id (idempotency key). */
  eventId?: string;
}

export type AssetEvent = (
  | {
      kind: "ai_job_update";
      /** Full latest job view — clients can replace their cached copy. */
      job: AiJobUpdatePayload;
      /** Server ms timestamp; useful for ignoring out-of-order pushes. */
      ts: number;
    }
  | {
      kind: "media_asset_moderation_changed";
      /** Logical media asset identity; clients should remove or restore cached usages by this id. */
      assetId: string;
      workspaceId?: string | null;
      projectIds?: string[];
      sourceSurface?: string | null;
      status: string;
      moderationStatus: "unreviewed" | "approved" | "flagged" | "blocked";
      moderationReason?: string | null;
      action: "approved" | "flagged" | "blocked" | "restored";
      updatedAt: string;
      ts: number;
    }
) &
  RealtimeEnvelope;

/** Azure Web PubSub group name for a user's asset events. */
export function assetsUserGroup(userId: string): string {
  return `assets-user:${userId}`;
}

export const ASSETS_HUB = "assets";
