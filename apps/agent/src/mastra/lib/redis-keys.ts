/**
 * Redis key schema — single source of truth.
 *
 * All Redis keys in the StoryOS v2 stack flow through the builders in this
 * module. Never concatenate `redis:*` keys with string templates elsewhere;
 * use `K.xxx(...)` and TTL constants so schemas stay centralized and
 * refactors are a one-liner.
 */

export const TTL = {
  /** Draft entities awaiting user confirmation */
  DRAFT: 7 * 24 * 3600,
  /** clientRefId → Java serverId mapping for idempotent writes */
  IDEM: 7 * 24 * 3600,
  /** Workflow run state + events + cancel flag */
  WORKFLOW: 30 * 24 * 3600,
  /** Short-lived Java GET response cache */
  JAVA_CACHE_SHORT: 60,
  /** Medium-lived Java GET response cache (snapshot-like reads) */
  JAVA_CACHE_MEDIUM: 300,
  /** Story skeleton — latest-wins per project; reused by downstream phases */
  OUTLINE: 30 * 24 * 3600,
} as const;

export const ENTITY_TYPES = ["film", "episode", "role", "scene", "prop", "script", "shot"] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const WORKFLOW_NAMES = [
  // Main pipelines — chain phases with HITL gates between each.
  "main_flow",
  // 用户已上传完整剧本 + 只要分镜的最小路径 flow。
  "script_to_storyboard_flow",
  // 用户已上传完整剧本 + 完整资产管线（角色/场景/道具图 + 分镜），但不 rewrite 剧本。
  "script_import_flow",
  // Single-phase workflows usable on their own.
  "role_design",
  "scene_design",
  "prop_design",
  "batch_create_asset",
  "script_edit",
  // Phase workflows (also reachable as main_flow / script_to_storyboard_flow sub-steps).
  "story_outline",
  "parse_script",
  "role_phase",
  "role_image_phase",
  "scene_phase",
  "scene_image_phase",
  "prop_phase",
  "prop_image_phase",
  "episode_phase",
  "script_phase",
  "storyboard_phase",
] as const;

export type WorkflowName = (typeof WORKFLOW_NAMES)[number];

/**
 * IDs flowing into keys must not contain the delimiter (`:`) or wildcard (`*`)
 * characters, or SCAN patterns and parsers elsewhere break in subtle ways.
 * We keep this cheap and permissive — just guard the obvious footguns.
 */
function assertSafeId(value: string, label: string): void {
  if (!value) throw new Error(`redis-keys: ${label} must be a non-empty string`);
  if (value.includes(":") || value.includes("*") || value.includes("\n")) {
    throw new Error(`redis-keys: ${label} "${value}" contains a reserved character (: * newline)`);
  }
}

export const K = {
  // ─── Chat ─────────────────────────────────────────────────────────
  chatMsg: (conversationId: string) => {
    assertSafeId(conversationId, "conversationId");
    return `chat:msg:${conversationId}`;
  },
  chatMeta: (conversationId: string) => {
    assertSafeId(conversationId, "conversationId");
    return `chat:meta:${conversationId}`;
  },

  // ─── Drafts ───────────────────────────────────────────────────────
  draft: (runId: string, entityType: EntityType, clientRefId: string) => {
    assertSafeId(runId, "runId");
    assertSafeId(clientRefId, "clientRefId");
    return `draft:${runId}:${entityType}:${clientRefId}`;
  },
  draftIndex: (runId: string) => {
    assertSafeId(runId, "runId");
    return `draft:${runId}:index`;
  },
  /** SCAN pattern to enumerate all drafts for a run */
  draftScan: (runId: string) => {
    assertSafeId(runId, "runId");
    return `draft:${runId}:*`;
  },

  // ─── Idempotency ──────────────────────────────────────────────────
  idem: (workspaceId: string, entityType: EntityType, clientRefId: string) => {
    assertSafeId(workspaceId, "workspaceId");
    assertSafeId(clientRefId, "clientRefId");
    return `idem:${workspaceId}:${entityType}:${clientRefId}`;
  },

  // ─── Workflow runtime ─────────────────────────────────────────────
  workflowState: (runId: string) => {
    assertSafeId(runId, "runId");
    return `workflow:run:${runId}:state`;
  },
  workflowCancel: (runId: string) => {
    assertSafeId(runId, "runId");
    return `workflow:run:${runId}:cancel`;
  },
  workflowResume: (runId: string) => {
    assertSafeId(runId, "runId");
    return `workflow:run:${runId}:resume_payload`;
  },

  // ─── Workflow indices (sorted sets by startedAt) ──────────────────
  workflowRunsByUser: (userId: string) => {
    assertSafeId(userId, "userId");
    return `workflow:user:${userId}:runs`;
  },
  workflowRunsByWorkspace: (workspaceId: string) => {
    assertSafeId(workspaceId, "workspaceId");
    return `workflow:workspace:${workspaceId}:runs`;
  },

  // ─── Asset image generation status ────────────────────────────────
  /**
   * Per-project hash tracking the image-generation status of each asset.
   * Field keys are `{assetType}:{assetId}` (e.g. "role:12345"); values are
   * JSON-encoded `{ status, imageUrl?, error?, updatedAt }`. Frontend polls
   * /aurora/assets/image-status?projectId=X which returns this hash.
   */
  projectAssetImageStatus: (projectId: string) => {
    assertSafeId(projectId, "projectId");
    return `project:${projectId}:asset-image-status`;
  },

  // ─── Story outline (skeleton produced by story_outline workflow) ─
  /**
   * Latest-wins per project. The story_outline workflow writes here on
   * completion; downstream phases (role/episode/script/storyboard) read
   * from here instead of re-analyzing raw text.
   */
  outline: (projectId: string) => {
    assertSafeId(projectId, "projectId");
    return `outline:${projectId}`;
  },

  // ─── Script chunks + embeddings (Phase 3) ─────────────────────────
  chunkMeta: (docId: string) => {
    assertSafeId(docId, "docId");
    return `chunks:${docId}:meta`;
  },
  chunk: (docId: string, idx: number) => {
    assertSafeId(docId, "docId");
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`redis-keys: chunk idx must be a non-negative integer, got ${idx}`);
    }
    return `chunks:${docId}:${idx}`;
  },
  embedIndex: (docId: string) => {
    assertSafeId(docId, "docId");
    return `embeddings:${docId}`;
  },

  // ─── Java read cache ──────────────────────────────────────────────
  javaCache: (endpointHash: string, paramHash: string) => {
    assertSafeId(endpointHash, "endpointHash");
    assertSafeId(paramHash, "paramHash");
    return `cache:java:${endpointHash}:${paramHash}`;
  },
} as const;

/**
 * Parse a draft key back into its components. Useful when SCAN returns keys
 * and we need to route by entityType.
 */
export function parseDraftKey(
  key: string
): { runId: string; entityType: EntityType; clientRefId: string } | null {
  const parts = key.split(":");
  if (parts.length !== 4 || parts[0] !== "draft") return null;
  const [, runId, entityType, clientRefId] = parts;
  if (!ENTITY_TYPES.includes(entityType as EntityType)) return null;
  return { runId, entityType: entityType as EntityType, clientRefId };
}
