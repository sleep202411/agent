import type {
  StorySubtitleTrack,
  StorySubtitleUpload,
  StorySubtitleLanguage,
  StorySubtitleTimeline,
} from "@repo/shared/story-subtitles";
import type { PutStoryStoryboardTimelineInput } from "@repo/shared";
import { api } from "@/lib/api";

export type StoryProductionStatus = "missing" | "current";
export type StoryProductionSpecStatus = "current" | "archived";
export type StoryAssetSpecKind = "character" | "location" | "prop";

export type StoryStoryboardClipKind = "image" | "video";
export type StoryStoryboardBindingMode = "follow_selected" | "pinned";
export type StoryAssetGenerationPurpose = "primary" | "turnaround";
export type StoryAiJobStatus =
  | "created"
  | "in_queue"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";
export type StoryGenerationMaterializationStatus =
  | "waiting_for_job"
  | "pending"
  | "completed"
  | "failed";

export interface StoryCreativeMediaVersion {
  id: string;
  versionNumber: number;
  mediaAssetId: string;
  mediaKind: string;
  mediaStatus: string;
  preferredVariantId: string | null;
  preferredVariantStatus?: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  mimeType: string | null;
  sourceFingerprint: string;
  purpose?: StoryAssetGenerationPurpose;
  createdAt: string;
}

export interface StoryLatestGeneration {
  id: string;
  outputKind: StoryStoryboardClipKind;
  purpose?: StoryAssetGenerationPurpose;
  requestedOutputCount: number;
  targetVersion: number;
  targetSourceFingerprint: string;
  retryOfGenerationId: string | null;
  aiJob: {
    id: string;
    modelId: string;
    schemaVersion: string;
    status: StoryAiJobStatus;
    stage: string;
    progress: number | null;
    queuePosition: number | null;
    estimatedWaitSeconds: number | null;
    estimatedRunSeconds: number | null;
    estimatedTotalSeconds: number | null;
    etaConfidence: string | null;
    error: unknown;
  };
  materialization: {
    status: StoryGenerationMaterializationStatus;
    attempts: number;
    canRetry: boolean;
    error: unknown;
    materializedAt: string | null;
    nextReconcileAt: string | null;
    retryUrl: string;
  };
  statusUrl: string;
  cancelUrl: string;
  retryUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoryProductionGeneration extends StoryLatestGeneration {
  projectId: string;
  chapterId: string;
  target:
    | { kind: "asset_spec"; id: string; sequenceId: null }
    | { kind: "storyboard_clip"; id: string; sequenceId: string };
  mediaVersions: StoryCreativeMediaVersion[];
  timing: {
    timelineDurationMs: number | null;
    requestedSourceDurationSeconds: number | null;
    generatedSourceDurationSeconds: number | null;
    trimToTimeline: boolean;
  };
}

export interface StoryAssetSpec {
  id: string;
  projectId: string;
  chapterId: string;
  stableKey: string;
  kind: StoryAssetSpecKind;
  sourceCharacterId: string | null;
  sourceNodeIds: string[];
  name: string;
  description: string | null;
  imagePrompt: string;
  videoPrompt: string | null;
  negativePrompt: string | null;
  generationConfig: unknown;
  sourceFingerprint: string;
  status: StoryProductionSpecStatus;
  version: number;
  selectedMediaVersionId: string | null;
  selectedMediaVersion: StoryCreativeMediaVersion | null;
  mediaVersions: StoryCreativeMediaVersion[];
  latestGeneration: StoryLatestGeneration | null;
  latestGenerations?: Record<StoryAssetGenerationPurpose, StoryLatestGeneration | null>;
  userModifiedAt: string | null;
  updatedAt: string;
}

export interface StoryProductionState {
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
  };
  storyboard: {
    status: StoryProductionStatus;
    sequenceCount: number;
    missingPlotNodeIds: string[];
  };
  ready: boolean;
}

export interface StoryStoryboardAssetBinding {
  id: string;
  assetSpecId: string;
  assetStableKey: string;
  role: string;
  mode: StoryStoryboardBindingMode;
  required: boolean;
  rank: number;
  status: StoryProductionSpecStatus;
  version: number;
  pinnedMediaVersionId: string | null;
  resolvedMediaVersion: StoryCreativeMediaVersion | null;
  assetSpec: StoryAssetSpec;
  userModifiedAt: string | null;
}

export interface StoryStoryboardClip {
  id: string;
  stableKey: string;
  title: string;
  rank: number;
  kind: StoryStoryboardClipKind;
  track: string;
  startMs: number;
  durationMs: number;
  description: string | null;
  imagePrompt: string | null;
  videoPrompt: string | null;
  negativePrompt: string | null;
  generationConfig: unknown;
  status: StoryProductionSpecStatus;
  version: number;
  selectedMediaVersionId: string | null;
  selectedMediaVersion: StoryCreativeMediaVersion | null;
  mediaVersions: StoryCreativeMediaVersion[];
  latestGeneration: StoryLatestGeneration | null;
  userModifiedAt: string | null;
  assetBindings: StoryStoryboardAssetBinding[];
}

export interface StoryStoryboardCue {
  id: string;
  stableKey: string;
  kind: "decision";
  plotDecisionId: string;
  atMs: number;
  durationMs: number;
  payload: unknown;
  status: StoryProductionSpecStatus;
  version: number;
  userModifiedAt: string | null;
}

export interface StoryStoryboardSequence {
  id: string;
  projectId: string;
  chapterId: string;
  plotNodeId: string;
  stableKey: string;
  /** @deprecated Display titles are projected from the canonical Plot node. */
  title: string | null;
  description: string | null;
  suggestedDurationMs: number;
  durationMs: number;
  sourceFingerprint: string;
  status: StoryProductionSpecStatus;
  version: number;
  userModifiedAt: string | null;
  subtitleTracks: StorySubtitleTrack[];
  subtitleTimeline: StorySubtitleTimeline;
  clips: StoryStoryboardClip[];
  cues: StoryStoryboardCue[];
  updatedAt: string;
}

export interface CreateStoryAssetGenerationInput {
  expectedVersion: number;
  outputKind?: StoryStoryboardClipKind;
  purpose?: StoryAssetGenerationPurpose;
  modelId?: string;
  schemaVersion?: string;
  options?: Record<string, boolean | number | string | Array<boolean | number | string>>;
}

export interface CreateStoryStoryboardClipGenerationInput {
  expectedVersion: number;
  modelId?: string;
  schemaVersion?: string;
  options?: Record<string, boolean | number | string | Array<boolean | number | string>>;
}

export interface RetryStoryProductionGenerationInput {
  expectedVersion: number;
}

export interface PatchStoryAssetSpecInput {
  expectedVersion: number;
  name?: string;
  description?: string | null;
  imagePrompt?: string;
  videoPrompt?: string | null;
  negativePrompt?: string | null;
  selectedMediaVersionId?: string | null;
  sourceMediaAssetId?: string;
  sourceMediaPurpose?: StoryAssetGenerationPurpose;
}

export interface CreateStoryAssetSpecInput {
  kind: StoryAssetSpecKind;
  name: string;
  description?: string | null;
  imagePrompt: string;
  videoPrompt?: string | null;
  negativePrompt?: string | null;
}

export interface ArchiveStoryAssetSpecInput {
  expectedVersion: number;
}

export interface PatchStoryStoryboardClipInput {
  expectedVersion: number;
  kind?: StoryStoryboardClipKind;
  title?: string;
  description?: string | null;
  imagePrompt?: string | null;
  videoPrompt?: string | null;
  selectedMediaVersionId?: string | null;
  sourceMediaAssetId?: string;
}

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

export interface StoryGenerationBatchItemError {
  code: string | null;
  message: string | null;
  retryable: boolean | null;
  requiredAmount: string | null;
  availableBalance: string | null;
  unavailableAmount: string | null;
}

export interface StoryGenerationBatch {
  id: string;
  projectId: string;
  chapterId: string;
  status: StoryGenerationBatchStatus;
  dispatchMode: "parallel" | "sequential";
  totalPoints: number;
  availablePoints: string | null;
  itemCount: number;
  version: number;
  quoteExpiresAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  blockedAt: string | null;
  blockReason: unknown;
  canCancel: boolean;
  counts: Record<StoryGenerationBatchItemStatus, number>;
  items: Array<{
    id: string;
    ordinal: number;
    status: StoryGenerationBatchItemStatus;
    targetKind: "asset_spec" | "storyboard_clip";
    targetId: string;
    sequenceId: string | null;
    targetVersion: number;
    outputKind: StoryStoryboardClipKind;
    modelId: string;
    schemaVersion: string;
    quotedPoints: number;
    generationId: string | null;
    error: unknown;
  }>;
}

export function storyGenerationBatchFailure(
  batch: StoryGenerationBatch
): StoryGenerationBatchItemError | null {
  const blocked = generationBatchError(batch.blockReason);
  if (blocked) return blocked;
  for (const item of batch.items) {
    if (item.status !== "failed") continue;
    const failure = generationBatchError(item.error);
    if (failure) return failure;
  }
  return null;
}

function generationBatchError(value: unknown): StoryGenerationBatchItemError | null {
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

export interface QuoteStoryAssetGenerationBatchInput {
  targets: Array<{ id: string; expectedVersion: number }>;
  outputKind?: StoryStoryboardClipKind;
  modelId?: string;
  schemaVersion?: string;
  options?: Record<string, boolean | number | string | Array<boolean | number | string>>;
}

/** Keep polling until cancellation and every provider submission have settled. */
export function storyGenerationBatchHasPendingItems(batch: StoryGenerationBatch): boolean {
  return (
    batch.status === "cancelling" ||
    batch.items.some(
      (item) =>
        item.status === "ready" || item.status === "dispatching" || item.status === "submitted"
    )
  );
}

export const storyProductionKeys = {
  state: (projectId: string, chapterId: string | null) =>
    ["story-studio", "production-state", projectId, chapterId] as const,
  assets: (projectId: string, chapterId: string | null, viewerId?: string | number | null) =>
    [
      "story-studio",
      "asset-specs",
      projectId,
      chapterId,
      ...(viewerId === undefined ? [] : [viewerId]),
    ] as const,
  storyboard: (projectId: string, chapterId: string | null) =>
    ["story-studio", "storyboard", projectId, chapterId] as const,
  generation: (
    projectId: string,
    chapterId: string | null,
    targetKind: "asset_spec" | "storyboard_clip",
    sequenceId: string | null,
    targetId: string,
    generationId: string | null
  ) =>
    [
      "story-studio",
      "production-generation",
      projectId,
      chapterId,
      targetKind,
      sequenceId,
      targetId,
      generationId,
    ] as const,
  batches: (projectId: string, chapterId: string | null) =>
    ["story-studio", "generation-batches", projectId, chapterId] as const,
  batch: (projectId: string, chapterId: string | null, batchId: string) =>
    [...storyProductionKeys.batches(projectId, chapterId), batchId] as const,
};

export async function getStoryProductionState(
  projectId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StoryProductionState> {
  const value = await api.get<StoryProductionState>(
    chapterPath(projectId, chapterId, "production-state"),
    {
      requestScope: "project",
      signal,
    }
  );
  assertChapterScope(value, projectId, chapterId);
  return value;
}

export async function listStoryAssetSpecs(
  projectId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StoryAssetSpec[]> {
  const values = await api.get<StoryAssetSpec[]>(chapterPath(projectId, chapterId, "asset-specs"), {
    requestScope: "project",
    signal,
  });
  values.forEach((value) => assertChapterScope(value, projectId, chapterId));
  return values;
}

export async function createStoryAssetSpec(
  projectId: string,
  chapterId: string,
  idempotencyKey: string,
  input: CreateStoryAssetSpecInput
): Promise<StoryAssetSpec> {
  const value = await api.post<StoryAssetSpec>(
    chapterPath(projectId, chapterId, "asset-specs"),
    projectMutationConfig(idempotencyKey, input)
  );
  assertChapterScope(value, projectId, chapterId);
  return value;
}

export async function getStoryStoryboard(
  projectId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StoryStoryboardSequence[]> {
  const values = await api.get<StoryStoryboardSequence[]>(
    chapterPath(projectId, chapterId, "storyboard"),
    {
      requestScope: "project",
      signal,
    }
  );
  values.forEach((value) => assertStoryboardScope(value, projectId, chapterId));
  return values;
}

export async function createStoryAssetGeneration(
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  idempotencyKey: string,
  input: CreateStoryAssetGenerationInput
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    assetGenerationPath(projectId, chapterId, assetSpecId),
    projectMutationConfig(idempotencyKey, input)
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function quoteStoryAssetGenerationBatch(
  projectId: string,
  chapterId: string,
  idempotencyKey: string,
  input: QuoteStoryAssetGenerationBatchInput
): Promise<StoryGenerationBatch> {
  return api.post<StoryGenerationBatch>(
    `${generationBatchesPath(projectId, chapterId)}/asset-specs/quote`,
    projectMutationConfig(idempotencyKey, input)
  );
}

export async function confirmStoryGenerationBatch(
  projectId: string,
  chapterId: string,
  batchId: string,
  expectedVersion: number
): Promise<StoryGenerationBatch> {
  return api.post<StoryGenerationBatch>(
    `${generationBatchesPath(projectId, chapterId)}/${encodeURIComponent(batchId)}/confirm`,
    { data: { expectedVersion }, requestScope: "project" }
  );
}

export async function listStoryGenerationBatches(
  projectId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StoryGenerationBatch[]> {
  return api.get<StoryGenerationBatch[]>(generationBatchesPath(projectId, chapterId), {
    requestScope: "project",
    signal,
  });
}

export async function getStoryGenerationBatch(
  projectId: string,
  chapterId: string,
  batchId: string,
  signal?: AbortSignal
): Promise<StoryGenerationBatch> {
  return api.get<StoryGenerationBatch>(
    `${generationBatchesPath(projectId, chapterId)}/${encodeURIComponent(batchId)}`,
    { requestScope: "project", signal }
  );
}

export async function cancelStoryGenerationBatch(
  projectId: string,
  chapterId: string,
  batchId: string
): Promise<StoryGenerationBatch> {
  return api.post<StoryGenerationBatch>(
    `${generationBatchesPath(projectId, chapterId)}/${encodeURIComponent(batchId)}/cancel`,
    { requestScope: "project" }
  );
}

export async function resumeStoryGenerationBatch(
  projectId: string,
  chapterId: string,
  batchId: string
): Promise<StoryGenerationBatch> {
  return api.post<StoryGenerationBatch>(
    `${generationBatchesPath(projectId, chapterId)}/${encodeURIComponent(batchId)}/resume`,
    { requestScope: "project" }
  );
}

export async function getStoryAssetGeneration(
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  generationId: string,
  signal?: AbortSignal
): Promise<StoryProductionGeneration> {
  const value = await api.get<StoryProductionGeneration>(
    assetGenerationPath(projectId, chapterId, assetSpecId, generationId),
    { requestScope: "project", signal }
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function cancelStoryAssetGeneration(
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  generationId: string
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    assetGenerationPath(projectId, chapterId, assetSpecId, generationId, "cancel"),
    { requestScope: "project" }
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function retryStoryAssetGeneration(
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  generationId: string,
  idempotencyKey: string,
  input: RetryStoryProductionGenerationInput
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    assetGenerationPath(projectId, chapterId, assetSpecId, generationId, "retry"),
    projectMutationConfig(idempotencyKey, input)
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function retryStoryAssetGenerationMaterialization(
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  generationId: string,
  retryUrl: string,
  idempotencyKey: string
): Promise<StoryProductionGeneration> {
  const expectedUrl = assetGenerationPath(
    projectId,
    chapterId,
    assetSpecId,
    generationId,
    "materialization/retry"
  );
  assertGenerationCommandUrl(retryUrl, expectedUrl);
  const value = await api.post<StoryProductionGeneration>(
    retryUrl,
    projectIdempotentCommandConfig(idempotencyKey)
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function createStoryStoryboardClipGeneration(
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  idempotencyKey: string,
  input: CreateStoryStoryboardClipGenerationInput
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    clipGenerationPath(projectId, chapterId, sequenceId, clipId),
    projectMutationConfig(idempotencyKey, input)
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function getStoryStoryboardClipGeneration(
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  generationId: string,
  signal?: AbortSignal
): Promise<StoryProductionGeneration> {
  const value = await api.get<StoryProductionGeneration>(
    clipGenerationPath(projectId, chapterId, sequenceId, clipId, generationId),
    { requestScope: "project", signal }
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function cancelStoryStoryboardClipGeneration(
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  generationId: string
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    clipGenerationPath(projectId, chapterId, sequenceId, clipId, generationId, "cancel"),
    { requestScope: "project" }
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function retryStoryStoryboardClipGeneration(
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  generationId: string,
  idempotencyKey: string,
  input: RetryStoryProductionGenerationInput
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    clipGenerationPath(projectId, chapterId, sequenceId, clipId, generationId, "retry"),
    projectMutationConfig(idempotencyKey, input)
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function retryStoryStoryboardClipGenerationMaterialization(
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  generationId: string,
  retryUrl: string,
  idempotencyKey: string
): Promise<StoryProductionGeneration> {
  const expectedUrl = clipGenerationPath(
    projectId,
    chapterId,
    sequenceId,
    clipId,
    generationId,
    "materialization/retry"
  );
  assertGenerationCommandUrl(retryUrl, expectedUrl);
  const value = await api.post<StoryProductionGeneration>(
    retryUrl,
    projectIdempotentCommandConfig(idempotencyKey)
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function patchStoryAssetSpec(
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  idempotencyKey: string,
  input: PatchStoryAssetSpecInput
): Promise<StoryAssetSpec> {
  return api.patch<StoryAssetSpec>(
    chapterPath(projectId, chapterId, `asset-specs/${encodeURIComponent(assetSpecId)}`),
    projectMutationConfig(idempotencyKey, input)
  );
}

export async function archiveStoryAssetSpec(
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  idempotencyKey: string,
  input: ArchiveStoryAssetSpecInput
): Promise<StoryAssetSpec> {
  const value = await api.delete<StoryAssetSpec>(
    chapterPath(projectId, chapterId, `asset-specs/${encodeURIComponent(assetSpecId)}`),
    projectMutationConfig(idempotencyKey, input)
  );
  assertChapterScope(value, projectId, chapterId);
  return value;
}

export interface PatchStoryStoryboardSequenceInput {
  expectedVersion: number;
  description?: string | null;
  subtitleUpload?: StorySubtitleUpload;
  removeSubtitleLanguage?: StorySubtitleLanguage;
}

export async function patchStoryStoryboardSequence(
  projectId: string,
  chapterId: string,
  sequenceId: string,
  idempotencyKey: string,
  input: PatchStoryStoryboardSequenceInput
): Promise<StoryStoryboardSequence> {
  const value = await api.patch<StoryStoryboardSequence>(
    chapterPath(projectId, chapterId, `storyboard/sequences/${encodeURIComponent(sequenceId)}`),
    projectMutationConfig(idempotencyKey, input)
  );
  assertChapterScope(value, projectId, chapterId);
  return value;
}

export async function patchStoryStoryboardClip(
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  idempotencyKey: string,
  input: PatchStoryStoryboardClipInput
): Promise<StoryStoryboardClip> {
  return api.patch<StoryStoryboardClip>(
    chapterPath(
      projectId,
      chapterId,
      `storyboard/sequences/${encodeURIComponent(sequenceId)}/clips/${encodeURIComponent(clipId)}`
    ),
    projectMutationConfig(idempotencyKey, input)
  );
}

/**
 * Atomically replace one plot node's complete visual timeline. Retained clip
 * ids preserve their generated media and Asset bindings on the server.
 */
export async function putStoryStoryboardTimeline(
  projectId: string,
  chapterId: string,
  sequenceId: string,
  idempotencyKey: string,
  input: PutStoryStoryboardTimelineInput
): Promise<StoryStoryboardSequence> {
  const value = await api.put<StoryStoryboardSequence>(
    chapterPath(
      projectId,
      chapterId,
      `storyboard/sequences/${encodeURIComponent(sequenceId)}/timeline`
    ),
    projectMutationConfig(idempotencyKey, input)
  );
  assertStoryboardScope(value, projectId, chapterId);
  if (value.id !== sequenceId) {
    throw new Error("Story production API returned data outside the requested sequence scope.");
  }
  return value;
}

export function createStoryProductionIdempotencyKey(operation: string): string {
  return `${operation}:${crypto.randomUUID()}`;
}

function chapterPath(projectId: string, chapterId: string, suffix: string): string {
  return `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/${suffix}`;
}

function generationBatchesPath(projectId: string, chapterId: string): string {
  return chapterPath(projectId, chapterId, "generation-batches");
}

function assetGenerationPath(
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  generationId?: string,
  action?: "cancel" | "retry" | "materialization/retry"
): string {
  const base = chapterPath(
    projectId,
    chapterId,
    `asset-specs/${encodeURIComponent(assetSpecId)}/generations`
  );
  if (!generationId) return base;
  return `${base}/${encodeURIComponent(generationId)}${action ? `/${action}` : ""}`;
}

function clipGenerationPath(
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  generationId?: string,
  action?: "cancel" | "retry" | "materialization/retry"
): string {
  const base = chapterPath(
    projectId,
    chapterId,
    `storyboard/sequences/${encodeURIComponent(sequenceId)}/clips/${encodeURIComponent(clipId)}/generations`
  );
  if (!generationId) return base;
  return `${base}/${encodeURIComponent(generationId)}${action ? `/${action}` : ""}`;
}

function projectMutationConfig(idempotencyKey: string, data: unknown) {
  return {
    data,
    requestScope: "project" as const,
    headers: { "Idempotency-Key": idempotencyKey },
  };
}

function projectIdempotentCommandConfig(idempotencyKey: string) {
  return {
    requestScope: "project" as const,
    headers: { "Idempotency-Key": idempotencyKey },
  };
}

function assertChapterScope(
  value: { projectId: string; chapterId: string },
  projectId: string,
  chapterId: string
): void {
  if (value.projectId !== projectId || value.chapterId !== chapterId) {
    throw new Error("Story production API returned data outside the requested chapter scope.");
  }
}

function assertStoryboardScope(
  value: StoryStoryboardSequence,
  projectId: string,
  chapterId: string
): void {
  assertChapterScope(value, projectId, chapterId);
  for (const clip of value.clips) {
    for (const binding of clip.assetBindings) {
      assertChapterScope(binding.assetSpec, projectId, chapterId);
    }
  }
}

function assertAssetGenerationScope(
  value: StoryProductionGeneration,
  projectId: string,
  chapterId: string,
  assetSpecId: string
): void {
  assertChapterScope(value, projectId, chapterId);
  if (
    value.target.kind !== "asset_spec" ||
    value.target.id !== assetSpecId ||
    value.target.sequenceId !== null
  ) {
    throw new Error("Story generation API returned data outside the requested Asset Spec scope.");
  }
}

function assertClipGenerationScope(
  value: StoryProductionGeneration,
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string
): void {
  assertChapterScope(value, projectId, chapterId);
  if (
    value.target.kind !== "storyboard_clip" ||
    value.target.id !== clipId ||
    value.target.sequenceId !== sequenceId
  ) {
    throw new Error("Story generation API returned data outside the requested storyboard scope.");
  }
}

function assertGenerationCommandUrl(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      "Story generation API returned a command URL outside the requested target scope."
    );
  }
}
