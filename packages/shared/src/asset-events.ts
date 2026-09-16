import type { StoryAgentRunRealtimeEvent } from "./story-agent.js";

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
 * Transport: the self-hosted realtime plane (Azure Web PubSub was decommissioned
 * in P5). Fan-out group: `assets-user:{userId}` (one per user, covers all tabs).
 *
 * Event kinds are durable product events, not provider callbacks.
 * Clients should merge them idempotently by the entity `updatedAt` / `ts`.
 */

export interface AiJobUpdatePayload {
  id: string;
  type: "image" | "video" | "audio";
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
    type: "image" | "video" | "audio";
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
  | {
      kind: "wallet_changed";
      /** The workspace whose compute pot changed (the wallet account's ownerId). */
      workspaceId: string;
      /** e.g. "compute_point". */
      currency: string;
      /** e.g. "consumable". */
      balanceKind: string;
      /** New balances — stringified bigint for JSON safety. Clients may use these
       * to update the cached balance directly, or simply refetch on the signal. */
      availableBalance: string;
      heldBalance: string;
      ts: number;
    }
  | {
      kind: "entitlement_changed";
      /** Whose entitlement changed — a user's personal plan or a workspace plan. */
      subjectType: "user" | "workspace";
      subjectId: string;
      planKey: string;
      status: "active" | "revoked" | "expired";
      startsAt?: string | null;
      endsAt?: string | null;
      action: "fulfilled" | "revoked" | "restored" | "expired";
      ts: number;
    }
  | {
      kind: "team_member_changed";
      /** The workspace whose membership roster changed. */
      workspaceId: string;
      action: "added" | "removed" | "role_changed";
      member: { id: string; userId: string; role: string; status?: string };
      ts: number;
    }
  | {
      kind: "project_changed";
      /** The workspace that owns the project. */
      workspaceId: string;
      projectId: string;
      action: "created" | "updated" | "archived";
      ts: number;
    }
  | {
      kind: "character_media_updated";
      /** The character whose media/provider-mirror state changed. */
      characterId: string;
      workspaceId: string;
      /** The affected CharacterMedia row (absent for character-level changes
       * like enrollment status flips). */
      characterMediaId?: string;
      /** Provider-mirror readiness for the media row (leave-and-notify UX):
       * pending | processing | active | failed | disabled | deleted. */
      mirrorStatus?: string;
      /** Typed upstream verdict when failed: face_mismatch | multi_face |
       * moderation | stale | ... */
      statusReason?: string | null;
      /** Character lifecycle status when the change is character-level
       * (e.g. pending_verification → active after enrollment). */
      characterStatus?: string;
      updatedAt: string;
      ts: number;
    }
  | {
      kind: "media_provider_asset_updated";
      /** Logical media asset identity whose provider mirror changed. */
      assetId: string;
      workspaceId?: string | null;
      /** pending | processing | active | disabled | deleted. */
      mirrorStatus: string;
      /** Typed upstream verdict when failed: moderation | stale | ... */
      statusReason?: string | null;
      updatedAt: string;
      ts: number;
    }
  | {
      /**
       * A compute-point credit just landed on a workspace wallet and at least
       * one previously INSUFFICIENT_COMPUTE_POINTS-blocked Story generation
       * batch now has enough balance to resume from its first unfinished
       * item. Notify-only: the creator decides whether to continue — nothing
       * auto-resumes.
       */
      kind: "story_generation_batches_resumable";
      workspaceId: string;
      /** New balance after the credit, stringified bigint for JSON safety. */
      availableBalance: string;
      /** Batches whose next unfinished item the balance now covers. */
      batches: Array<{
        batchId: string;
        projectId: string;
        chapterId: string;
        /** Points needed for the first unfinished item. */
        requiredPoints: string;
      }>;
      ts: number;
    }
  | StoryAgentRunRealtimeEvent
) &
  RealtimeEnvelope;

/** Fan-out group name for a user's asset events. */
export function assetsUserGroup(userId: string): string {
  return `assets-user:${userId}`;
}

export const ASSETS_HUB = "assets";
