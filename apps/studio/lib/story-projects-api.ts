import { api, ApiRequestError } from "@/lib/api";
import { STORY_VISUAL_STYLE_SKILL_SLUGS, type StoryVisualStyleSkillSlug } from "@repo/shared";
import type {
  StoryCondition,
  StoryEndingKind,
  StoryExitRoute,
  StoryRouteTarget,
  StoryStateEffect,
  StoryStateValueType,
} from "@repo/shared/story-stats";
import {
  StoryPlotImportError,
  type StoryPlotImport,
  type StoryPlotImportMode,
} from "@/lib/story-plot-import";

/**
 * Product Story Studio client.
 *
 * StoryProject belongs to a workspace. Direct project membership and workspace
 * roles authorize access; new generation uses the project workspace wallet.
 * Mutable drafts use revision CAS; Build records capture server-owned
 * immutable input snapshots automatically.
 */

export const INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION = "interactive-story-draft-v1" as const;
export const STORY_CANVAS_LAYOUT_SCHEMA_VERSION = "story-canvas-layout-v3" as const;

export type StoryProjectStatus = "active" | "archived";
export type StoryVisibility = "private" | "unlisted" | "public";
export type StoryFrameProfile = "landscape_16_9" | "portrait_9_16";
export type StoryDurationPreset = "short_5_15" | "medium_15_30" | "long_30_60";
export type StoryVisualStyle = StoryVisualStyleSkillSlug;

export const STORY_FRAME_PROFILE_CONTRACTS = {
  landscape_16_9: { aspectRatio: "16:9", width: 1920, height: 1080 },
  portrait_9_16: { aspectRatio: "9:16", width: 1080, height: 1920 },
} as const satisfies Record<
  StoryFrameProfile,
  { aspectRatio: "16:9" | "9:16"; width: number; height: number }
>;
export type StoryCapability =
  | "story.read"
  | "story.edit"
  | "story.generate"
  | "story.review"
  | "story.build"
  | "story.release"
  | "story.admin";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MediaAssetSummary {
  id: string;
  kind: "image" | "video" | "audio" | "document" | "other";
  status: "uploading" | "ready" | "failed" | "deleted";
  moderationStatus: "unreviewed" | "approved" | "flagged" | "blocked";
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  checksumSha256: string | null;
  previewUrl: string | null;
}

export interface StoryCandidateAsset {
  asset: MediaAssetSummary;
  videoVariant: {
    id: string;
    variantKey: string;
    contentType: string;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    checksumSha256: string | null;
  } | null;
  addedByUserId: string;
  addedAt: string;
}

/**
 * One reusable, ready video variant from the active project's workspace.
 *
 * The asset remains the durable history record; the variant fields describe
 * the exact playable original that can be bound as a clip's current
 * video directly.
 */
export interface StoryProjectProductionSummary {
  referenceSlotCount: number;
  approvedReferenceCount: number;
  clipCount: number;
  currentVideoCount: number;
  latestBuildStatus:
    | "queued"
    | "validating"
    | "compiling"
    | "ready"
    | "failed"
    | "cancelled"
    | null;
}

export interface StoryProjectSummary {
  canMove: boolean;
  id: string;
  workspaceId: string;
  frameProfile: StoryFrameProfile;
  frameProfileMutable: boolean;
  durationPreset: StoryDurationPreset | null;
  visualStyle: StoryVisualStyle | null;
  creativeProfileConfirmedAt: string | null;
  status: StoryProjectStatus;
  visibility: StoryVisibility;
  title: string;
  summary: string | null;
  defaultLocale: string;
  cover: MediaAssetSummary | null;
  tags: string[];
  /** Publication introduction authored by the creator; null when unset. */
  storeListing: StoryStoreListing | null;
  sourceIpId: string | null;
  projectVersion: number;
  draftRevision: number;
  production: StoryProjectProductionSummary;
  capabilities: StoryCapability[];
  createdAt: string;
  updatedAt: string;
}

/** One plain-text publication introduction, currently single-locale.
 * Media fields reference the project's candidate assets. */
export interface StoryStoreListing {
  description: string;
  tags: string[];
  developer: string;
  trailerAssetId: string | null;
  screenshotAssetIds: string[];
}

export interface StoryBillingBalance {
  workspaceId: string;
  availablePoints: string;
  heldPoints: string;
  totalPoints: string;
}

export function storyBillingBalanceQueryKey(projectId: string) {
  return ["story-studio", "billing-balance", projectId] as const;
}

export interface StoryBibleStateVariable {
  key: string;
  name: Record<string, string>;
  valueType: StoryStateValueType;
  initialValue: number | boolean;
  note?: string;
}

export interface StoryBibleEnding {
  endingId: string;
  title: Record<string, string>;
  kind: StoryEndingKind;
}

export type StoryBibleWriterPatch = Partial<{
  logline: string;
  synopsis: string;
  stateVariables: StoryBibleStateVariable[];
  endings: StoryBibleEnding[];
}>;

export interface StoryGraphChoice {
  choiceId: string;
  label: Record<string, string>;
  effects?: StoryStateEffect[];
  visibleWhen?: StoryCondition;
  target: StoryRouteTarget | null;
}

export type StoryInteractionAction =
  | { kind: "continue"; effects?: StoryStateEffect[] }
  | { kind: "pause"; effects?: StoryStateEffect[] }
  | { kind: "seek"; timeMs: number; effects?: StoryStateEffect[] }
  | { kind: "goto"; target: StoryRouteTarget; effects?: StoryStateEffect[] };

export type StoryInteractionTrigger =
  | { kind: "tap" }
  | { kind: "swipe"; direction: "up" | "down" | "left" | "right" }
  | {
      kind: "press-hold";
      durationMs: number;
      /**
       * Timeline-control charge: the clip pauses while the input window is
       * open and only advances while the pointer is held, so playback
       * position is the charge progress. Optional because the server fills
       * the legacy default (false) when omitted.
       */
      controlTimeline?: boolean;
    };

export interface StoryInteractionOutcomes {
  success: StoryInteractionAction;
  failure?: StoryInteractionAction;
  timeout?: StoryInteractionAction;
}

export interface StoryHotspotInteraction {
  kind: "hotspot";
  interactionId: string;
  label: Record<string, string>;
  trigger: StoryInteractionTrigger;
  rect: { x: number; y: number; width: number; height: number };
  startMs: number;
  endMs: number;
  /**
   * Safe branch frame: a resolved interaction keeps playing the current clip
   * until this timestamp before the branch cut lands. Omitted means the
   * window end (legacy cut-on-resolution behavior).
   */
  branchAtMs?: number;
  /** Omitted means the clip keeps playing through the window. */
  timing?: "window" | "hold";
  outcomes: StoryInteractionOutcomes;
}

/** A choice shown when its clip finishes. */
export interface StoryChoiceExit {
  kind: "choice";
  decisionId: string;
  prompt: Record<string, string>;
  choices: StoryGraphChoice[];
}

export interface StoryClipGraphNode {
  /** Authoring price; omitted means free. Currency is community_point. */
  communityPointPrice?: number;
  kind: "clip";
  nodeId: string;
  clipKey: string;
  name?: string;
  description?: string;
  interactions: StoryHotspotInteraction[];
  onEnterEffects?: StoryStateEffect[];
  exit: { kind: "auto"; routes: StoryExitRoute[] } | StoryChoiceExit;
}

export interface StoryDecisionGraphNode {
  kind: "decision";
  nodeId: string;
  onEnterEffects?: StoryStateEffect[];
  exit: StoryChoiceExit;
}

export type StoryGraphNode = StoryClipGraphNode | StoryDecisionGraphNode;

export interface InteractiveStoryDraftContent {
  storyBible: {
    logline: string;
    synopsis: string;
    characters: Array<{
      id: string;
      name: Record<string, string>;
      summary: string;
      /** Appearance-reference images (形象图); the label names the look. */
      images: Array<{ mediaAssetId: string; url: string; label: string }>;
      /** Voice-clone sample (音色), hard-capped at 5 seconds. */
      voice: { mediaAssetId: string; url: string; durationMs: number } | null;
    }>;
    stateVariables?: StoryBibleStateVariable[];
    endings?: StoryBibleEnding[];
  };
  graph: { entryNodeId: string | null; nodes: StoryGraphNode[] };
  productionNotes: string[];
}

export interface StoryDraft {
  projectId: string;
  chapterId: string | null;
  schemaVersion: typeof INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION;
  content: InteractiveStoryDraftContent;
  contentHash: string;
  revision: number;
  updatedByUserId: string;
  updatedBySessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryCanvasPosition {
  x: number;
  y: number;
}

export interface StoryCanvasLayout {
  projectId: string;
  chapterId: string;
  schemaVersion: typeof STORY_CANVAS_LAYOUT_SCHEMA_VERSION;
  nodePositions: Record<string, StoryCanvasPosition>;
  revision: number;
  updatedByUserId: string;
  updatedBySessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StoryReferenceKind =
  | "character"
  | "location"
  | "prop"
  | "graphic"
  | "style"
  | "join_frame"
  | "first_frame"
  | "last_frame";

export interface StoryReferenceSlotSpec {
  key: string;
  kind: StoryReferenceKind;
  label: string;
  description: string;
  required: boolean;
  rank: number;
}

export interface StoryReferenceSlot {
  id: string;
  projectId: string;
  key: string;
  kind: StoryReferenceKind;
  label: string;
  description: string;
  required: boolean;
  rank: number;
  version: number;
  status: "empty" | "candidate" | "approved" | "invalidated";
  approvedVersionId: string | null;
  versions: StoryReferenceVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryReferenceVersion {
  id: string;
  slotId: string;
  number: number;
  source: "upload" | "ai_job" | "import";
  aiJobId: string | null;
  aiJobOutputId: string | null;
  asset: MediaAssetSummary;
  variantId: string;
  promptSnapshot: Record<string, unknown> | null;
  configSnapshot: Record<string, unknown> | null;
  checksumSha256: string;
  reviewRevision: number;
  approved: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface StoryReferenceReviewChecklist {
  technical: StoryReviewChecklistValue;
  identityContinuity: StoryReviewChecklistValue;
  rights: StoryReviewChecklistValue;
  safety: StoryReviewChecklistValue;
}

export type StoryBuildStatus =
  | "queued"
  | "validating"
  | "compiling"
  | "ready"
  | "failed"
  | "cancelled";

export type StoryBuildScope =
  | { kind: "full" }
  | { kind: "subgraph"; entryClipId: string; maxDepth?: number };

export interface StoryBuildDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityType: "revision" | "node" | "clip" | "reference" | "choice" | "asset" | null;
  entityId: string | null;
  chapterId?: string;
  details?:
    | {
        kind: "state-effect-type";
        nodeTitle: string;
        choiceLabel: string | null;
        effectIndex: number;
        variableName: string;
        operation: "add" | "set";
        variableType: "number" | "boolean";
      }
    | {
        kind: "shot";
        sceneTitle: string;
        shotTitle: string;
      }
    | {
        kind: "missing-sequence";
        sceneTitle: string;
      }
    | {
        kind: "duplicate-playback";
        playbackId: string;
        shots: Array<{ sceneTitle: string; shotTitle: string }>;
      };
}

export interface StoryBuildPathReport {
  enumeratedPathCount: number;
  reachableTerminalNodeIds: string[];
  unreachableNodeIds: string[];
  ambiguousPathCount: number;
  durationMinMs: number;
  durationMaxMs: number;
}

export interface FrozenStoryAsset {
  logicalKey: string;
  assetId: string;
  variantId: string;
  checksumSha256: string | null;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  browserSafeMp4: boolean | null;
  sizeBytes: string | null;
}

export interface StoryBuildAsset extends FrozenStoryAsset {
  id: string;
  buildId: string;
  clipId: string | null;
  role: string;
}

export interface StoryBuildSummary {
  id: string;
  number: number;
  scope: StoryBuildScope;
  status: StoryBuildStatus;
  sourceDraftRevision: number;
  videoSnapshotHash: string;
  diagnostics: StoryBuildDiagnostic[];
  createdAt: string;
  completedAt: string | null;
}

export interface StoryBuild {
  id: string;
  projectId: string;
  number: number;
  version: number;
  scope: StoryBuildScope;
  status: StoryBuildStatus;
  sourceDraftRevision: number;
  videoSnapshotHash: string;
  inputHash: string;
  inputManifestHash: string;
  runtimeSchemaVersion: 1 | 2;
  runtimeJson: Record<string, unknown> | null;
  runtimeHash: string | null;
  assets: StoryBuildAsset[];
  diagnostics: StoryBuildDiagnostic[];
  pathReport: StoryBuildPathReport | null;
  createdByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Ephemeral playtest compiled from the saved authoring head.
 *
 * Unlike StoryBuild this is not a release artifact and does not freeze the
 * project. Every playable node resolves its single current video binding.
 */
export interface StoryWorkingPreview {
  draftRevision: number;
  contentHash: string;
  videoSnapshotHash: string | null;
  runtimeSchemaVersion: 2;
  runtime: Record<string, unknown> | null;
  coverUrl: string | null;
  diagnostics: StoryBuildDiagnostic[];
  pathReport: StoryBuildPathReport | null;
  sources: Array<{
    graphNodeId: string;
    assetId: string;
    variantId: string;
    selectionVersion: number;
    selection: "current";
  }>;
}
export type StoryReviewDecision = "approve" | "reject" | "request_changes";
export type StoryReviewChecklistValue = "pass" | "fail" | "na";

export interface StoryReview {
  id: string;
  decision: StoryReviewDecision;
  checklist: Record<string, StoryReviewChecklistValue>;
  comment: string | null;
  reviewerUserId: string;
  createdAt: string;
}

export interface StoryWorkbench {
  project: StoryProjectSummary;
  chapters: StoryChapter[];
  chapter: StoryChapter;
  draft: StoryDraft;
  script: {
    documentId: string | null;
    currentSequence: number;
    sourceVersionId: string | null;
    sourceSequence: number | null;
    status: "missing" | "current" | "stale" | "unlinked";
  };
  video: {
    snapshotHash: string;
  };
  references: StoryReferenceSlot[];
  latestBuild: StoryBuildSummary | null;
}

export interface StoryChapter {
  id: string;
  projectId: string;
  title: string;
  rank: number;
  entryNodeId: string | null;
  nodeCount: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStoryProjectInput {
  workspaceId: string;
  title: string;
  summary?: string | null;
  defaultLocale: string;
  visibility?: "private" | "unlisted";
  sourceIpId?: string | null;
}

function storyIdempotencyHeaders(idempotencyKey: string): HeadersInit {
  if (!idempotencyKey.trim()) throw new Error("This operation requires an idempotency key.");
  return { "Idempotency-Key": idempotencyKey };
}

export async function createStoryProject(
  input: CreateStoryProjectInput
): Promise<StoryProjectSummary> {
  const workbench = await api.post<StoryWorkbench>("/aurora/story-projects", {
    data: input,
  });
  assertProjectSummary(workbench.project);
  return workbench.project;
}

export async function listStoryProjects(query: {
  workspaceId: string;
  status?: StoryProjectStatus;
  cursor?: string;
  limit?: number;
}): Promise<CursorPage<StoryProjectSummary>> {
  const page = await api.get<CursorPage<StoryProjectSummary>>("/aurora/story-projects", {
    params: query,
    requestScope: "project",
  });
  if (!page || !Array.isArray(page.items)) {
    throw new Error("Story Studio API returned an invalid project page.");
  }
  page.items.forEach(assertProjectSummary);
  return page;
}

export async function getStoryWorkbench(
  projectId: string,
  chapterId?: string,
  signal?: AbortSignal
): Promise<StoryWorkbench> {
  const workbench = await api.get<StoryWorkbench>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/workbench`,
    {
      signal,
      params: chapterId ? { chapterId } : undefined,
      requestScope: "project",
    }
  );
  if (!workbench || typeof workbench !== "object" || !("project" in workbench)) {
    throw new Error("Story Studio API returned an invalid workbench.");
  }
  assertProjectSummary(workbench.project);
  return workbench;
}

export async function getStoryBillingBalance(projectId: string): Promise<StoryBillingBalance> {
  return api.get<StoryBillingBalance>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/billing/balance`,
    { requestScope: "project" }
  );
}

export async function createStoryChapter(
  projectId: string,
  input: { title: string }
): Promise<StoryChapter> {
  return api.post<StoryChapter>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters`,
    { data: input, requestScope: "project" }
  );
}

export async function updateStoryChapter(
  projectId: string,
  chapterId: string,
  input: { title: string }
): Promise<StoryChapter> {
  return api.patch<StoryChapter>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`,
    { data: input, requestScope: "project" }
  );
}

export async function reorderStoryChapters(
  projectId: string,
  input: { expectedProjectVersion: number; chapterIds: string[] }
): Promise<StoryChapter[]> {
  return api.put<StoryChapter[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/order`,
    { data: input, requestScope: "project" }
  );
}

export async function archiveStoryChapter(
  projectId: string,
  chapterId: string
): Promise<StoryChapter> {
  return api.post<StoryChapter>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/archive`,
    { requestScope: "project" }
  );
}

export async function getStoryCanvasLayout(
  projectId: string,
  chapterId: string,
  signal?: AbortSignal
): Promise<StoryCanvasLayout> {
  return api.get<StoryCanvasLayout>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/canvas-layout`,
    { requestScope: "project", signal }
  );
}

export async function getStoryCandidateAssets(
  projectId: string,
  signal?: AbortSignal
): Promise<StoryCandidateAsset[]> {
  const value = await api.get<unknown>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/candidate-assets`,
    { requestScope: "project", signal }
  );
  if (!Array.isArray(value)) {
    throw new Error("Story Studio API returned an invalid candidate asset collection.");
  }
  value.forEach(assertStoryCandidateAsset);
  return value;
}

export async function addStoryCandidateAsset(
  projectId: string,
  mediaAssetId: string,
  signal?: AbortSignal
): Promise<StoryCandidateAsset> {
  const value = await api.put<unknown>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/candidate-assets/${encodeURIComponent(mediaAssetId)}`,
    { requestScope: "project", signal }
  );
  assertStoryCandidateAsset(value);
  return value;
}

export async function removeStoryCandidateAsset(
  projectId: string,
  mediaAssetId: string,
  signal?: AbortSignal
): Promise<{ mediaAssetId: string }> {
  return api.delete<{ mediaAssetId: string }>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/candidate-assets/${encodeURIComponent(mediaAssetId)}`,
    { requestScope: "project", signal }
  );
}

export async function putStoryCanvasLayout(
  projectId: string,
  chapterId: string,
  input: {
    expectedRevision: number;
    nodePositions: Record<string, StoryCanvasPosition>;
    sessionId: string;
  },
  request?: Pick<RequestInit, "keepalive">
): Promise<StoryCanvasLayout> {
  return api.put<StoryCanvasLayout>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/canvas-layout`,
    {
      data: { schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION, ...input },
      requestScope: "project",
      ...request,
    }
  );
}

export async function updateStoryProject(
  projectId: string,
  input: {
    expectedProjectVersion: number;
    title?: string;
    summary?: string | null;
    coverAssetId?: string | null;
    defaultLocale?: string;
    visibility?: StoryVisibility;
    tags?: string[];
    storeListing?: StoryStoreListing | null;
    frameProfile?: StoryFrameProfile;
    durationPreset?: StoryDurationPreset;
    visualStyle?: StoryVisualStyle;
    confirmCreativeProfile?: true;
  },
  signal?: AbortSignal
): Promise<StoryProjectSummary> {
  return api.patch<StoryProjectSummary>(`/aurora/story-projects/${encodeURIComponent(projectId)}`, {
    data: input,
    requestScope: "project",
    signal,
  });
}

export async function archiveStoryProject(
  projectId: string,
  expectedProjectVersion: number
): Promise<void> {
  await api.post(`/aurora/story-projects/${encodeURIComponent(projectId)}/archive`, {
    data: { expectedProjectVersion },
    requestScope: "project",
  });
}

export async function putStoryDraft(
  projectId: string,
  chapterId: string,
  input: {
    expectedRevision: number;
    content: InteractiveStoryDraftContent;
    sessionId: string;
  },
  request?: Pick<RequestInit, "keepalive">
): Promise<StoryDraft> {
  return api.put<StoryDraft>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/draft`,
    {
      data: { schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION, ...input },
      requestScope: "project",
      ...request,
    }
  );
}

export async function importStoryPlot(
  projectId: string,
  chapterId: string,
  input: {
    expectedRevision: number;
    content: InteractiveStoryDraftContent;
    sessionId: string;
    locale: string;
    mode: StoryPlotImportMode;
    plot: StoryPlotImport;
  }
): Promise<{ draft: StoryDraft; importedNodeIds: string[] }> {
  const value = await api.post<unknown>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/plot-import`,
    {
      data: { schemaVersion: INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION, ...input },
      requestScope: "project",
    }
  );
  if (!value || typeof value !== "object") {
    throw new Error("Story Studio API returned an invalid plot import.");
  }
  const record = value as { draft?: StoryDraft; importedNodeIds?: unknown };
  if (
    !record.draft ||
    !Array.isArray(record.importedNodeIds) ||
    !record.importedNodeIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Story Studio API returned an invalid plot import.");
  }
  return { draft: record.draft, importedNodeIds: record.importedNodeIds };
}

export function storyPlotImportError(error: unknown): StoryPlotImportError | null {
  if (error instanceof StoryPlotImportError) return error;
  if (!(error instanceof ApiRequestError)) return null;
  const body = storyApiErrorBody(error);
  if (body?.code !== "STORY_PLOT_IMPORT_INVALID") return null;
  const importCode = body.importCode;
  const path = typeof body.path === "string" ? body.path : "$";
  if (typeof importCode !== "string") return null;
  return new StoryPlotImportError(importCode as StoryPlotImportError["code"], path);
}

export async function createStoryBuild(
  projectId: string,
  input: {
    expectedDraftRevision: number;
    expectedVideoSnapshotHash: string;
    scope: StoryBuildScope;
  },
  idempotencyKey: string
): Promise<StoryBuild> {
  return api.post<StoryBuild>(`/aurora/story-projects/${encodeURIComponent(projectId)}/builds`, {
    data: input,
    headers: storyIdempotencyHeaders(idempotencyKey),
    requestScope: "project",
  });
}

export async function getStoryBuild(projectId: string, buildId: string): Promise<StoryBuild> {
  return api.get<StoryBuild>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/builds/${encodeURIComponent(buildId)}`,
    { requestScope: "project" }
  );
}

export async function getStoryWorkingPreview(
  projectId: string,
  chapterId?: string,
  sceneId?: string
): Promise<StoryWorkingPreview> {
  const params = {
    ...(chapterId ? { chapterId } : {}),
    ...(sceneId ? { sceneId } : {}),
  };
  return api.get<StoryWorkingPreview>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/working-preview`,
    {
      ...(Object.keys(params).length > 0 ? { params } : {}),
      requestScope: "project",
    }
  );
}

export async function listStoryReferenceSlots(projectId: string): Promise<StoryReferenceSlot[]> {
  return api.get<StoryReferenceSlot[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots`,
    { requestScope: "project" }
  );
}

export async function createStoryReferenceSlots(
  projectId: string,
  input: { slots: StoryReferenceSlotSpec[] },
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<StoryReferenceSlot[]> {
  return api.post<StoryReferenceSlot[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots`,
    {
      data: input,
      headers: storyIdempotencyHeaders(idempotencyKey),
      requestScope: "project",
      signal,
    }
  );
}

export async function listStoryReferenceVersions(
  projectId: string,
  slotId: string
): Promise<StoryReferenceVersion[]> {
  return api.get<StoryReferenceVersion[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}/versions`,
    { requestScope: "project" }
  );
}

export async function updateStoryReferenceSlot(
  projectId: string,
  slotId: string,
  input: {
    expectedSlotVersion: number;
    slot: StoryReferenceSlotSpec;
  },
  signal?: AbortSignal
): Promise<StoryReferenceSlot> {
  return api.put<StoryReferenceSlot>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}`,
    { data: input, requestScope: "project", signal }
  );
}

export async function createStoryReferenceVersion(
  projectId: string,
  slotId: string,
  input: {
    expectedSlotVersion: number;
    assetId: string;
    variantId: string;
    source: "upload" | "import";
    promptSnapshot?: Record<string, unknown>;
    configSnapshot?: Record<string, unknown>;
  },
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<StoryReferenceVersion> {
  return api.post<StoryReferenceVersion>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}/versions`,
    {
      data: input,
      headers: storyIdempotencyHeaders(idempotencyKey),
      requestScope: "project",
      signal,
    }
  );
}

export async function reviewStoryReferenceVersion(
  projectId: string,
  slotId: string,
  referenceVersionId: string,
  input: {
    expectedReviewRevision: number;
    decision: StoryReviewDecision;
    checklist: StoryReferenceReviewChecklist;
    comment?: string;
  },
  signal?: AbortSignal
): Promise<{ reference: StoryReferenceVersion; review: StoryReview }> {
  return api.post<{ reference: StoryReferenceVersion; review: StoryReview }>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}/versions/${encodeURIComponent(referenceVersionId)}/reviews`,
    { data: input, requestScope: "project", signal }
  );
}

export async function approveStoryReferenceVersion(
  projectId: string,
  slotId: string,
  input: {
    expectedSlotVersion: number;
    referenceVersionId: string;
    approveReviewId: string;
  },
  signal?: AbortSignal
): Promise<StoryReferenceSlot> {
  return api.post<StoryReferenceSlot>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}/approval`,
    { data: input, requestScope: "project", signal }
  );
}

export function storyApiErrorCode(error: unknown): string | null {
  const body = storyApiErrorBody(error);
  return typeof body?.code === "string" ? body.code : null;
}

export function storyApiErrorBody(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (!error.responseBody) {
    return typeof error.code === "string" ? { code: error.code, message: error.message } : null;
  }
  try {
    const parsed = JSON.parse(error.responseBody) as Record<string, unknown>;
    const nested = parsed.response;
    return typeof nested === "object" && nested !== null
      ? (nested as Record<string, unknown>)
      : parsed;
  } catch {
    return { code: error.code, message: error.message };
  }
}

export function storyApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    const body = storyApiErrorBody(error);
    const issues = Array.isArray(body?.issues) ? body.issues : [];
    const issueDetails = issues
      .map((issue) => {
        if (!issue || typeof issue !== "object") return null;
        const record = issue as Record<string, unknown>;
        const message = typeof record.message === "string" ? record.message.trim() : "";
        if (!message) return null;
        const path = typeof record.path === "string" ? record.path.trim() : "";
        return path ? `${path}: ${message}` : message;
      })
      .filter((issue): issue is string => Boolean(issue));
    if (issueDetails.length > 0) return issueDetails.join("; ");
    if (error.message.trim()) return error.message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export interface DraftRevisionConflict {
  code: "DRAFT_REVISION_CONFLICT";
  expectedRevision: number;
  actualRevision: number;
  current: StoryDraft;
}

export interface CanvasLayoutRevisionConflict {
  code: "CANVAS_LAYOUT_REVISION_CONFLICT";
  expectedRevision: number;
  actualRevision: number;
  current: StoryCanvasLayout;
}

export function draftRevisionConflict(error: unknown): DraftRevisionConflict | null {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return null;
  const body = storyApiErrorBody(error);
  if (body?.code !== "DRAFT_REVISION_CONFLICT") return null;
  if (
    typeof body.expectedRevision !== "number" ||
    typeof body.actualRevision !== "number" ||
    typeof body.current !== "object" ||
    body.current === null
  ) {
    return null;
  }
  return body as unknown as DraftRevisionConflict;
}

export function canvasLayoutRevisionConflict(error: unknown): CanvasLayoutRevisionConflict | null {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return null;
  const body = storyApiErrorBody(error);
  if (body?.code !== "CANVAS_LAYOUT_REVISION_CONFLICT") return null;
  if (
    typeof body.expectedRevision !== "number" ||
    typeof body.actualRevision !== "number" ||
    typeof body.current !== "object" ||
    body.current === null
  ) {
    return null;
  }
  return body as unknown as CanvasLayoutRevisionConflict;
}

function assertProjectSummary(value: unknown): asserts value is StoryProjectSummary {
  if (!value || typeof value !== "object") {
    throw new Error("Story Studio API returned an invalid project.");
  }
  const project = value as Partial<StoryProjectSummary>;
  const creativeProfileEmpty =
    project.durationPreset === null &&
    project.visualStyle === null &&
    project.creativeProfileConfirmedAt === null;
  const creativeProfileComplete =
    project.durationPreset != null &&
    project.visualStyle != null &&
    project.creativeProfileConfirmedAt != null;
  if (
    (project.frameProfile !== "landscape_16_9" && project.frameProfile !== "portrait_9_16") ||
    typeof project.frameProfileMutable !== "boolean" ||
    (project.durationPreset !== null &&
      project.durationPreset !== "short_5_15" &&
      project.durationPreset !== "medium_15_30" &&
      project.durationPreset !== "long_30_60") ||
    (project.visualStyle !== null &&
      (typeof project.visualStyle !== "string" ||
        !(STORY_VISUAL_STYLE_SKILL_SLUGS as readonly string[]).includes(project.visualStyle))) ||
    (project.creativeProfileConfirmedAt !== null &&
      !validIsoTimestamp(project.creativeProfileConfirmedAt)) ||
    (!creativeProfileEmpty && !creativeProfileComplete) ||
    !Array.isArray(project.capabilities) ||
    !project.production ||
    typeof project.production !== "object" ||
    typeof project.projectVersion !== "number" ||
    typeof project.draftRevision !== "number"
  ) {
    throw new Error(
      "Story Studio API contract is out of date. Apply the product-plane migration and restart the server."
    );
  }
}

function assertStoryCandidateAsset(value: unknown): asserts value is StoryCandidateAsset {
  if (!value || typeof value !== "object") {
    throw new Error("Story Studio API returned an invalid candidate asset.");
  }
  const candidate = value as Partial<StoryCandidateAsset>;
  const asset = candidate.asset;
  const videoVariant = candidate.videoVariant;
  const assetValid =
    asset &&
    typeof asset === "object" &&
    nonEmptyString(asset.id) &&
    ["image", "video", "audio"].includes(asset.kind) &&
    asset.status === "ready" &&
    ["unreviewed", "approved", "flagged"].includes(asset.moderationStatus) &&
    nonEmptyString(asset.contentType) &&
    nullablePositiveInteger(asset.width) &&
    nullablePositiveInteger(asset.height) &&
    nullableNonNegativeNumber(asset.durationSeconds) &&
    nullableNonEmptyString(asset.checksumSha256) &&
    nullableNonEmptyString(asset.previewUrl);
  const variantValid =
    videoVariant === null ||
    (typeof videoVariant === "object" &&
      nonEmptyString(videoVariant.id) &&
      videoVariant.variantKey === "original" &&
      nonEmptyString(videoVariant.contentType) &&
      videoVariant.contentType.toLowerCase().startsWith("video/") &&
      nullablePositiveInteger(videoVariant.width) &&
      nullablePositiveInteger(videoVariant.height) &&
      nullablePositiveNumber(videoVariant.durationSeconds) &&
      nullableSha256String(videoVariant.checksumSha256));
  if (
    !assetValid ||
    !variantValid ||
    (asset.kind !== "video" && videoVariant !== null) ||
    !nonEmptyString(candidate.addedByUserId) ||
    !validIsoTimestamp(candidate.addedAt)
  ) {
    throw new Error("Story Studio API returned an invalid candidate asset.");
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function sha256String(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveNumber(value: unknown): value is number {
  return finiteNumber(value) && value > 0;
}

function nullableNonEmptyString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value);
}

function nullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function nullablePositiveNumber(value: unknown): value is number | null {
  return value === null || positiveNumber(value);
}

function nullablePositiveInteger(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value > 0)
  );
}

function nullableSha256String(value: unknown): value is string | null {
  return value === null || sha256String(value);
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

export async function moveStoryProject(
  projectId: string,
  input: { targetWorkspaceId: string; expectedWorkspaceId: string; expectedProjectVersion: number }
): Promise<{ projectId: string; workspaceId: string; projectVersion: number }> {
  return api.post(`/aurora/story-projects/${encodeURIComponent(projectId)}/move`, {
    data: input,
    requestScope: "project",
  });
}
