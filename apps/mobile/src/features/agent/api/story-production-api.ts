/**
 * Story production read APIs — chapter-scoped asset specs, script documents,
 * and production-stage state (browse surfaces).
 * Paths omit `/aurora`; `api` resolves the aurora base URL.
 */

import { api } from "@/lib/api-client";

const AURORA = { service: "aurora" as const };

export type StoryAssetSpecKind = "character" | "location" | "prop";
export type StoryProductionSpecStatus = "current" | "stale" | "archived";
export type StoryProductionStatus = "missing" | "current" | "stale";

export type StoryCreativeMediaVersion = {
  id: string;
  versionNumber: number;
  mediaAssetId: string;
  mediaKind: string;
  mediaStatus: string;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  mimeType: string | null;
};

export type StoryAssetSpecPlanItem = {
  kind: StoryAssetSpecKind;
  name: string;
  description: string;
  imagePrompt: string;
};

export type StoryProductionConflict<TPendingItem> = {
  pendingSourceFingerprint: string;
  pendingPlanFingerprint: string;
  removed: boolean;
  pendingItem: TPendingItem | null;
};

export type StoryProductionConflictResolution = "keep_current" | "use_latest_plan";

export type StoryAssetSpec = {
  id: string;
  projectId: string;
  chapterId: string;
  stableKey: string;
  kind: StoryAssetSpecKind;
  name: string;
  description: string | null;
  imagePrompt?: string | null;
  status: StoryProductionSpecStatus;
  version: number;
  pendingSourceFingerprint: string | null;
  conflict: StoryProductionConflict<StoryAssetSpecPlanItem> | null;
  selectedMediaVersion: StoryCreativeMediaVersion | null;
  mediaVersions: StoryCreativeMediaVersion[];
};

export type StoryAssetSpecConflictResolutionResult = {
  targetKind: "asset_spec";
  targetId: string;
  resolution: StoryProductionConflictResolution;
  outcome: "kept_current" | "applied_latest" | "archived";
  item: StoryAssetSpec;
  productionState: StoryProductionState;
};

export type StoryStoryboardClipKind = "image" | "video";

export type StoryStoryboardClip = {
  id: string;
  title: string;
  selectedMediaVersion: StoryCreativeMediaVersion | null;
};

export type StoryStoryboardSequence = {
  id: string;
  projectId: string;
  chapterId: string;
  plotNodeId: string;
  title: string | null;
  clips: StoryStoryboardClip[];
};

export type StoryGenerationBatchStatus =
  | "awaiting_confirmation"
  | "blocked"
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "partial_failed"
  | "cancelled"
  | "failed"
  | "expired";

export type StoryGenerationBatchItemStatus =
  | "awaiting_confirmation"
  | "ready"
  | "dispatching"
  | "submitted"
  | "completed"
  | "failed"
  | "cancelled";

export type StoryGenerationBatchItemError = {
  code: string | null;
  message: string | null;
  retryable: boolean | null;
  requiredAmount: string | null;
  availableBalance: string | null;
  unavailableAmount: string | null;
};

export type StoryGenerationBatchItem = {
  id: string;
  ordinal: number;
  status: StoryGenerationBatchItemStatus;
  targetKind: "asset_spec" | "storyboard_clip";
  targetId: string;
  sequenceId: string | null;
  quotedPoints: number;
  error: unknown;
};

export type StoryGenerationBatch = {
  id: string;
  projectId: string;
  chapterId: string;
  status: StoryGenerationBatchStatus;
  totalPoints: number;
  availablePoints: string | null;
  itemCount: number;
  canCancel: boolean;
  counts: Record<StoryGenerationBatchItemStatus, number>;
  items: StoryGenerationBatchItem[];
  blockReason?: unknown;
};

export type StoryProductionState = {
  projectId: string;
  chapterId: string;
  profile: { status: "current" | "missing" };
  script: {
    status: StoryProductionStatus;
    documentId: string | null;
    sequence: number | null;
  };
  plotTree: { status: StoryProductionStatus; nodeCount: number };
  assets: {
    status: StoryProductionStatus;
    currentCount: number;
    staleCount: number;
  };
  storyboard: {
    status: StoryProductionStatus;
    sequenceCount: number;
    staleCount: number;
    missingPlotNodeIds: string[];
  };
  ready: boolean;
};

export type StoryDocumentRef = {
  id: string;
  type: string;
  title: string;
  contentSnapshot?: Record<string, unknown> | null;
};

function chapterPath(projectId: string, chapterId: string, suffix: string): string {
  return `/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/${suffix}`;
}

export const storyProductionApi = {
  listAssetSpecs(projectId: string, chapterId: string, signal?: AbortSignal) {
    return api.get<StoryAssetSpec[]>(chapterPath(projectId, chapterId, "asset-specs"), {
      ...AURORA,
      signal,
      timeout: 30_000,
    });
  },

  getStoryboard(projectId: string, chapterId: string, signal?: AbortSignal) {
    return api.get<StoryStoryboardSequence[]>(chapterPath(projectId, chapterId, "storyboard"), {
      ...AURORA,
      signal,
      timeout: 30_000,
    });
  },

  getGenerationBatch(projectId: string, chapterId: string, batchId: string, signal?: AbortSignal) {
    return api.get<StoryGenerationBatch>(
      `${chapterPath(projectId, chapterId, "generation-batches")}/${encodeURIComponent(batchId)}`,
      { ...AURORA, signal, timeout: 30_000 }
    );
  },

  cancelGenerationBatch(projectId: string, chapterId: string, batchId: string) {
    return api.post<StoryGenerationBatch>(
      `${chapterPath(projectId, chapterId, "generation-batches")}/${encodeURIComponent(batchId)}/cancel`,
      { ...AURORA, data: {}, timeout: 30_000 }
    );
  },

  resumeGenerationBatch(projectId: string, chapterId: string, batchId: string) {
    return api.post<StoryGenerationBatch>(
      `${chapterPath(projectId, chapterId, "generation-batches")}/${encodeURIComponent(batchId)}/resume`,
      { ...AURORA, data: {}, timeout: 30_000 }
    );
  },

  getProductionState(projectId: string, chapterId: string, signal?: AbortSignal) {
    return api.get<StoryProductionState>(chapterPath(projectId, chapterId, "production-state"), {
      ...AURORA,
      signal,
      timeout: 30_000,
    });
  },

  resolveAssetSpecConflict(
    projectId: string,
    chapterId: string,
    assetSpecId: string,
    input: {
      expectedVersion: number;
      expectedPendingSourceFingerprint: string;
      resolution: StoryProductionConflictResolution;
    }
  ) {
    return api.post<StoryAssetSpecConflictResolutionResult>(
      chapterPath(
        projectId,
        chapterId,
        `asset-specs/${encodeURIComponent(assetSpecId)}/conflict-resolution`
      ),
      {
        ...AURORA,
        data: input,
        headers: { "Idempotency-Key": createStoryProductionIdempotencyKey() },
        timeout: 30_000,
      }
    );
  },

  ensureScriptDocument(projectId: string, chapterId: string, signal?: AbortSignal) {
    return api.post<{ document: StoryDocumentRef }>(
      chapterPath(projectId, chapterId, "documents/script/ensure"),
      { ...AURORA, data: {}, signal, timeout: 30_000 }
    );
  },

  getDocument(documentId: string, signal?: AbortSignal) {
    return api.get<{ document: StoryDocumentRef }>(`/documents/${encodeURIComponent(documentId)}`, {
      ...AURORA,
      signal,
      timeout: 30_000,
    });
  },
};

/** Ensure script document id, then load the materialized content snapshot (+ CRDT). */
export async function loadStoryScriptSnapshot(
  projectId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StoryDocumentRef> {
  const ensured = await storyProductionApi.ensureScriptDocument(projectId, chapterId, signal);
  const documentId = ensured.document?.id?.trim();
  if (!documentId) {
    throw new Error("Story Studio did not return a script document id");
  }
  const detail = await storyProductionApi.getDocument(documentId, signal);
  return detail.document;
}

export function storyGenerationBatchHasPendingItems(batch: StoryGenerationBatch): boolean {
  return (
    batch.status === "cancelling" ||
    batch.items.some(
      (item) =>
        item.status === "ready" || item.status === "dispatching" || item.status === "submitted"
    )
  );
}

export function storyGenerationBatchFailure(
  batch: StoryGenerationBatch
): StoryGenerationBatchItemError | null {
  const fromBlock = generationBatchErrorFromUnknown(batch.blockReason);
  if (fromBlock) return fromBlock;
  for (const item of batch.items) {
    if (item.status !== "failed") continue;
    const failure = generationBatchErrorFromUnknown(item.error);
    if (failure) return failure;
  }
  return null;
}

function generationBatchErrorFromUnknown(value: unknown): StoryGenerationBatchItemError | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = value as Record<string, unknown>;
  const code = typeof error.code === "string" ? error.code.trim() : "";
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (!code && !message) return null;
  return {
    code: code || null,
    message: message || null,
    retryable: typeof error.retryable === "boolean" ? error.retryable : null,
    requiredAmount: stringDetail(error.requiredAmount),
    availableBalance: stringDetail(error.availableBalance),
    unavailableAmount: stringDetail(error.unavailableAmount),
  };
}

function stringDetail(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function isActiveGenerationItem(status: StoryGenerationBatchItemStatus): boolean {
  return status === "ready" || status === "dispatching" || status === "submitted";
}

export function sequentiallyRevealedGenerationItems(
  items: readonly StoryGenerationBatchItem[]
): StoryGenerationBatchItem[] {
  const ordered = [...items].sort((left, right) => left.ordinal - right.ordinal);
  const visible: StoryGenerationBatchItem[] = [];
  for (const item of ordered) {
    visible.push(item);
    if (item.status !== "completed" && item.status !== "failed" && item.status !== "cancelled") {
      break;
    }
    if (item.status === "failed" || item.status === "cancelled") break;
  }
  return visible;
}

export function generationItemFailureDetail(error: unknown): string | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const value = error as Record<string, unknown>;
  for (const key of ["userMessage", "message", "detail"] as const) {
    const message = value[key];
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return null;
}

export function fillMessageTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key])
  );
}

export function storyAssetSpecConflictIsResolvable(asset: StoryAssetSpec): boolean {
  return (
    asset.status === "stale" &&
    asset.conflict != null &&
    asset.pendingSourceFingerprint != null &&
    typeof asset.version === "number" &&
    asset.pendingSourceFingerprint === asset.conflict.pendingSourceFingerprint
  );
}

function createStoryProductionIdempotencyKey(): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `story-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `story-conflict-resolution:${uuid}`;
}
