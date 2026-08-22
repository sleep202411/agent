import type { StoryAssetSpecPlanItem, StoryStoryboardSequencePlanItem } from "@repo/shared";
import { api } from "@/lib/api";

export type StoryProductionStatus = "missing" | "current" | "stale";
export type StoryProductionSpecStatus = "current" | "stale" | "archived";
export type StoryAssetSpecKind = "character" | "location" | "prop";

export type StoryStoryboardClipKind = "image" | "video";
export type StoryStoryboardBindingMode = "follow_selected" | "pinned";
export type StoryProductionPlanDisposition = "planned" | "user_override";
export type StoryProductionConflictResolution = "keep_current" | "use_latest_plan";
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
  createdAt: string;
}

export interface StoryLatestGeneration {
  id: string;
  outputKind: StoryStoryboardClipKind;
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
  planDisposition: StoryProductionPlanDisposition;
  pendingSourceFingerprint: string | null;
  conflict: StoryProductionConflict<StoryAssetSpecPlanItem> | null;
  version: number;
  selectedMediaVersionId: string | null;
  selectedMediaVersion: StoryCreativeMediaVersion | null;
  mediaVersions: StoryCreativeMediaVersion[];
  latestGeneration: StoryLatestGeneration | null;
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
    staleCount: number;
  };
  storyboard: {
    status: StoryProductionStatus;
    sequenceCount: number;
    staleCount: number;
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
  title: string | null;
  description: string | null;
  suggestedDurationMs: number;
  durationMs: number;
  sourceFingerprint: string;
  status: StoryProductionSpecStatus;
  planDisposition: StoryProductionPlanDisposition;
  pendingSourceFingerprint: string | null;
  conflict: StoryProductionConflict<StoryStoryboardSequencePlanItem> | null;
  version: number;
  userModifiedAt: string | null;
  clips: StoryStoryboardClip[];
  cues: StoryStoryboardCue[];
  updatedAt: string;
}

export interface StoryProductionConflict<TPendingItem> {
  pendingSourceFingerprint: string;
  pendingPlanFingerprint: string;
  removed: boolean;
  pendingItem: TPendingItem | null;
}

export interface ResolveStoryProductionConflictInput {
  expectedVersion: number;
  expectedPendingSourceFingerprint: string;
  resolution: StoryProductionConflictResolution;
}

export interface StoryAssetSpecConflictResolutionResult {
  targetKind: "asset_spec";
  targetId: string;
  resolution: StoryProductionConflictResolution;
  outcome: "kept_current" | "applied_latest" | "archived";
  item: StoryAssetSpec;
  productionState: StoryProductionState;
}

export interface StoryStoryboardSequenceConflictResolutionResult {
  targetKind: "storyboard_sequence";
  targetId: string;
  resolution: StoryProductionConflictResolution;
  outcome: "kept_current" | "applied_latest" | "archived";
  item: StoryStoryboardSequence;
  productionState: StoryProductionState;
}

export interface CreateStoryAssetGenerationInput {
  expectedVersion: number;
  outputKind?: StoryStoryboardClipKind;
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
}

export const storyProductionKeys = {
  state: (workspaceId: string | null, projectId: string, chapterId: string | null) =>
    ["story-studio", "production-state", workspaceId, projectId, chapterId] as const,
  assets: (workspaceId: string | null, projectId: string, chapterId: string | null) =>
    ["story-studio", "asset-specs", workspaceId, projectId, chapterId] as const,
  storyboard: (workspaceId: string | null, projectId: string, chapterId: string | null) =>
    ["story-studio", "storyboard", workspaceId, projectId, chapterId] as const,
  generation: (
    workspaceId: string | null,
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
      workspaceId,
      projectId,
      chapterId,
      targetKind,
      sequenceId,
      targetId,
      generationId,
    ] as const,
};

export async function getStoryProductionState(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StoryProductionState> {
  const value = await api.get<StoryProductionState>(
    chapterPath(projectId, chapterId, "production-state"),
    {
      headers: workspaceHeaders(workspaceId),
      signal,
    }
  );
  assertChapterScope(value, projectId, chapterId);
  return value;
}

export async function listStoryAssetSpecs(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StoryAssetSpec[]> {
  const values = await api.get<StoryAssetSpec[]>(chapterPath(projectId, chapterId, "asset-specs"), {
    headers: workspaceHeaders(workspaceId),
    signal,
  });
  values.forEach((value) => assertChapterScope(value, projectId, chapterId));
  return values;
}

export async function getStoryStoryboard(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StoryStoryboardSequence[]> {
  const values = await api.get<StoryStoryboardSequence[]>(
    chapterPath(projectId, chapterId, "storyboard"),
    {
      headers: workspaceHeaders(workspaceId),
      signal,
    }
  );
  values.forEach((value) => assertStoryboardScope(value, projectId, chapterId));
  return values;
}

export async function createStoryAssetGeneration(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  idempotencyKey: string,
  input: CreateStoryAssetGenerationInput
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    assetGenerationPath(projectId, chapterId, assetSpecId),
    mutationConfig(workspaceId, idempotencyKey, input)
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function getStoryAssetGeneration(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  generationId: string,
  signal?: AbortSignal
): Promise<StoryProductionGeneration> {
  const value = await api.get<StoryProductionGeneration>(
    assetGenerationPath(projectId, chapterId, assetSpecId, generationId),
    { headers: workspaceHeaders(workspaceId), signal }
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function cancelStoryAssetGeneration(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  generationId: string
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    assetGenerationPath(projectId, chapterId, assetSpecId, generationId, "cancel"),
    { headers: workspaceHeaders(workspaceId) }
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function retryStoryAssetGeneration(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  generationId: string,
  idempotencyKey: string,
  input: RetryStoryProductionGenerationInput
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    assetGenerationPath(projectId, chapterId, assetSpecId, generationId, "retry"),
    mutationConfig(workspaceId, idempotencyKey, input)
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function retryStoryAssetGenerationMaterialization(
  workspaceId: string,
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
    idempotentCommandConfig(workspaceId, idempotencyKey)
  );
  assertAssetGenerationScope(value, projectId, chapterId, assetSpecId);
  return value;
}

export async function createStoryStoryboardClipGeneration(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  idempotencyKey: string,
  input: CreateStoryStoryboardClipGenerationInput
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    clipGenerationPath(projectId, chapterId, sequenceId, clipId),
    mutationConfig(workspaceId, idempotencyKey, input)
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function getStoryStoryboardClipGeneration(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  generationId: string,
  signal?: AbortSignal
): Promise<StoryProductionGeneration> {
  const value = await api.get<StoryProductionGeneration>(
    clipGenerationPath(projectId, chapterId, sequenceId, clipId, generationId),
    { headers: workspaceHeaders(workspaceId), signal }
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function cancelStoryStoryboardClipGeneration(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  sequenceId: string,
  clipId: string,
  generationId: string
): Promise<StoryProductionGeneration> {
  const value = await api.post<StoryProductionGeneration>(
    clipGenerationPath(projectId, chapterId, sequenceId, clipId, generationId, "cancel"),
    { headers: workspaceHeaders(workspaceId) }
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function retryStoryStoryboardClipGeneration(
  workspaceId: string,
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
    mutationConfig(workspaceId, idempotencyKey, input)
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function retryStoryStoryboardClipGenerationMaterialization(
  workspaceId: string,
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
    idempotentCommandConfig(workspaceId, idempotencyKey)
  );
  assertClipGenerationScope(value, projectId, chapterId, sequenceId, clipId);
  return value;
}

export async function patchStoryAssetSpec(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  idempotencyKey: string,
  input: PatchStoryAssetSpecInput
): Promise<StoryAssetSpec> {
  return api.patch<StoryAssetSpec>(
    chapterPath(projectId, chapterId, `asset-specs/${encodeURIComponent(assetSpecId)}`),
    mutationConfig(workspaceId, idempotencyKey, input)
  );
}

export async function resolveStoryAssetSpecConflict(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  assetSpecId: string,
  idempotencyKey: string,
  input: ResolveStoryProductionConflictInput
): Promise<StoryAssetSpecConflictResolutionResult> {
  const value = await api.post<StoryAssetSpecConflictResolutionResult>(
    chapterPath(
      projectId,
      chapterId,
      `asset-specs/${encodeURIComponent(assetSpecId)}/conflict-resolution`
    ),
    mutationConfig(workspaceId, idempotencyKey, input)
  );
  assertConflictResolutionScope(value, "asset_spec", assetSpecId, projectId, chapterId);
  return value;
}

export async function resolveStoryStoryboardSequenceConflict(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  sequenceId: string,
  idempotencyKey: string,
  input: ResolveStoryProductionConflictInput
): Promise<StoryStoryboardSequenceConflictResolutionResult> {
  const value = await api.post<StoryStoryboardSequenceConflictResolutionResult>(
    chapterPath(
      projectId,
      chapterId,
      `storyboard/sequences/${encodeURIComponent(sequenceId)}/conflict-resolution`
    ),
    mutationConfig(workspaceId, idempotencyKey, input)
  );
  assertConflictResolutionScope(value, "storyboard_sequence", sequenceId, projectId, chapterId);
  return value;
}

export function createStoryProductionIdempotencyKey(operation: string): string {
  return `${operation}:${crypto.randomUUID()}`;
}

async function mutateSequence(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  suffix: string,
  idempotencyKey: string,
  input: unknown,
  method: "patch" | "put"
): Promise<StoryStoryboardSequence> {
  const value = await api[method]<StoryStoryboardSequence>(
    chapterPath(projectId, chapterId, suffix),
    mutationConfig(workspaceId, idempotencyKey, input)
  );
  assertStoryboardScope(value, projectId, chapterId);
  return value;
}

function chapterPath(projectId: string, chapterId: string, suffix: string): string {
  return `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/${suffix}`;
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

function workspaceHeaders(workspaceId: string): Record<string, string> {
  return { "x-fizz-workspace-id": workspaceId };
}

function mutationConfig(workspaceId: string, idempotencyKey: string, data: unknown) {
  return {
    data,
    headers: {
      ...workspaceHeaders(workspaceId),
      "Idempotency-Key": idempotencyKey,
    },
  };
}

function idempotentCommandConfig(workspaceId: string, idempotencyKey: string) {
  return {
    headers: {
      ...workspaceHeaders(workspaceId),
      "Idempotency-Key": idempotencyKey,
    },
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

function assertConflictResolutionScope(
  value: StoryAssetSpecConflictResolutionResult | StoryStoryboardSequenceConflictResolutionResult,
  targetKind: "asset_spec" | "storyboard_sequence",
  targetId: string,
  projectId: string,
  chapterId: string
): void {
  if (value.targetKind !== targetKind || value.targetId !== targetId) {
    throw new Error("Story conflict resolution returned data outside the requested target scope.");
  }
  assertChapterScope(value.item, projectId, chapterId);
  assertChapterScope(value.productionState, projectId, chapterId);
}

function assertGenerationCommandUrl(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      "Story generation API returned a command URL outside the requested target scope."
    );
  }
}
