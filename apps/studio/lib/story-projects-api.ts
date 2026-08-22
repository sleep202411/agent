import { api, ApiRequestError } from "@/lib/api";

/**
 * Product Story Studio client.
 *
 * StoryProject is a sovereign project root. It is scoped to the active
 * workspace by the API client's x-fizz-workspace-id header and never borrows a
 * PlatformProject id. Mutable drafts use revision CAS; Build records capture
 * server-owned immutable input snapshots automatically.
 */

export const INTERACTIVE_STORY_DRAFT_SCHEMA_VERSION = "interactive-story-draft-v1" as const;
export const STORY_CANVAS_LAYOUT_SCHEMA_VERSION = "story-canvas-layout-v3" as const;

export type StoryProjectStatus = "active" | "archived";
export type StoryVisibility = "private" | "unlisted" | "public";
export type StoryFrameProfile = "landscape_16_9" | "portrait_9_16";
export type StoryDurationPreset = "short_5_15" | "medium_15_30" | "long_30_60";
export type StoryVisualStyle =
  | "cinematic_realism"
  | "stylized_3d"
  | "graphic_novel"
  | "anime_cinematic";

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
export interface StoryVideoLibraryItem {
  asset: MediaAssetSummary;
  variantId: string;
  variantKey: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  checksumSha256: string | null;
  createdAt: string;
}

export type StoryClipVideoFinalizationStatus =
  | "queued"
  | "processing"
  | "ready"
  | "failed"
  | "expired"
  | "cancelled";

export interface StoryClipVideoFinalization {
  mediaAssetId: string;
  status: StoryClipVideoFinalizationStatus;
  pollAfterMs: number | null;
  item: StoryVideoLibraryItem | null;
  error: { code: string; message: string } | null;
}

export class StoryClipVideoFinalizationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StoryClipVideoFinalizationError";
    this.code = code;
  }
}

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
  sourceIpId: string | null;
  projectVersion: number;
  draftRevision: number;
  production: StoryProjectProductionSummary;
  capabilities: StoryCapability[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryGraphChoice {
  choiceId: string;
  label: Record<string, string>;
  nextNodeId: string;
}

export type StoryInteractionAction =
  | { kind: "continue" }
  | { kind: "seek"; timeMs: number }
  | { kind: "goto"; nodeId: string };

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
  kind: "clip";
  nodeId: string;
  clipKey: string;
  name?: string;
  description?: string;
  interactions: StoryHotspotInteraction[];
  exit: { kind: "auto"; nextNodeId: string | null } | StoryChoiceExit;
}

export interface StoryWorldGraphNode {
  kind: "world";
  nodeId: string;
  worldId: string | null;
  name?: string;
  entryInstruction?: string;
  maxExperienceSeconds: 60 | 90 | 120;
  exit: { kind: "auto"; nextNodeId: string | null };
}

export type StoryGraphNode = StoryClipGraphNode | StoryWorldGraphNode;

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

export interface StoryCurrentVideo {
  asset: MediaAssetSummary;
  variantId: string;
  checksumSha256: string | null;
  contentType: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: string | null;
  browserSafeMp4: boolean | null;
  selectionVersion: number;
  setByUserId: string | null;
  setAt: string;
}

export interface StoryClipVideoSummary {
  graphNodeId: string;
  selectionVersion: number;
  currentVideo: StoryCurrentVideo | null;
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
  entityType: "revision" | "clip" | "reference" | "choice" | "asset" | null;
  entityId: string | null;
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

export interface StoryBuildPublication {
  status: "pending" | "confirmed" | "uncertain" | "rejected";
  gameId: string;
  contentVersion: string;
  manifestUrl: string | null;
  publishedAt: string | null;
  mediaAuthorizedAt: string;
  mediaAuthorizationRevokedAt: string | null;
  authorityIsCurrent: boolean | null;
  authorityGameExists: boolean | null;
  authorityCurrentVersion: string | null;
  authorityCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorDetail: string | null;
}

export interface StoryBuildSummary {
  id: string;
  number: number;
  scope: StoryBuildScope;
  status: StoryBuildStatus;
  sourceDraftRevision: number;
  videoSnapshotHash: string;
  diagnostics: StoryBuildDiagnostic[];
  publication: StoryBuildPublication | null;
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
  publication: StoryBuildPublication | null;
  createdByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

export interface ExperienceReleaseResult {
  gameId: string;
  contentVersion: string;
  status: "published" | "draft";
  manifestUrl: string;
}

export interface StoryExperienceCurrentRelease {
  projectId: string;
  gameId: string;
  published: boolean;
  currentVersion: string | null;
  manifestUrl: string | null;
  currentBuild: {
    id: string;
    sourceDraftRevision: number;
    videoSnapshotHash: string;
  } | null;
  checkedAt: string | null;
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
    clips: StoryClipVideoSummary[];
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
  title: string;
  summary?: string | null;
  defaultLocale: string;
  visibility?: "private" | "unlisted";
  sourceIpId?: string | null;
}

function storyWorkspaceHeaders(workspaceId: string): HeadersInit {
  if (!workspaceId.trim()) {
    throw new Error("Story Studio requires an active workspace.");
  }
  return { "x-fizz-workspace-id": workspaceId };
}

function storyIdempotencyHeaders(workspaceId: string, idempotencyKey: string): HeadersInit {
  if (!workspaceId.trim()) throw new Error("Story Studio requires an active workspace.");
  if (!idempotencyKey.trim()) throw new Error("This operation requires an idempotency key.");
  return {
    "x-fizz-workspace-id": workspaceId,
    "Idempotency-Key": idempotencyKey,
  };
}

export async function createStoryProject(
  workspaceId: string,
  input: CreateStoryProjectInput
): Promise<StoryProjectSummary> {
  const workbench = await api.post<StoryWorkbench>("/aurora/story-projects", {
    data: input,
    headers: storyWorkspaceHeaders(workspaceId),
  });
  assertProjectSummary(workbench.project);
  return workbench.project;
}

export async function listStoryProjects(
  workspaceId: string,
  query: {
    status?: StoryProjectStatus;
    cursor?: string;
    limit?: number;
  } = {}
): Promise<CursorPage<StoryProjectSummary>> {
  const page = await api.get<CursorPage<StoryProjectSummary>>("/aurora/story-projects", {
    params: query,
    headers: storyWorkspaceHeaders(workspaceId),
  });
  if (!page || !Array.isArray(page.items)) {
    throw new Error("Story Studio API returned an invalid project page.");
  }
  page.items.forEach(assertProjectSummary);
  return page;
}

/**
 * The projects someone else invited you into, across every workspace.
 *
 * `listStoryProjects` is scoped to the workspace you are looking at, which is
 * right for the switcher but hides a shared project: it lives in the inviter's
 * workspace, not yours. Each summary carries its own `workspaceId`, so opening
 * one is a switch plus a navigation — no resolve round-trip needed.
 */
export async function listJoinedStoryProjects(
  query: {
    status?: StoryProjectStatus;
    cursor?: string;
    limit?: number;
  } = {}
): Promise<CursorPage<StoryProjectSummary>> {
  const page = await api.get<CursorPage<StoryProjectSummary>>(
    "/aurora/story-projects/shared-with-me",
    { params: query }
  );
  if (!page || !Array.isArray(page.items)) {
    throw new Error("Story Studio API returned an invalid project page.");
  }
  page.items.forEach(assertProjectSummary);
  return page;
}

/**
 * Finalizes a direct Story Studio clip-video upload into one reusable,
 * workspace-owned original variant. The returned item can be passed directly
 * to the existing current-video CAS mutation.
 */
export async function completeStoryClipVideoUpload(
  workspaceId: string,
  projectId: string,
  input: { mediaAssetId: string },
  signal?: AbortSignal
): Promise<StoryClipVideoFinalization> {
  const finalization = await api.post<StoryClipVideoFinalization>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/video-library/uploads/complete`,
    {
      data: input,
      headers: storyWorkspaceHeaders(workspaceId),
      signal,
    }
  );
  assertStoryClipVideoFinalization(finalization, input.mediaAssetId);
  return finalization;
}

export async function getStoryClipVideoUploadFinalization(
  workspaceId: string,
  projectId: string,
  mediaAssetId: string,
  signal?: AbortSignal
): Promise<StoryClipVideoFinalization> {
  const finalization = await api.get<StoryClipVideoFinalization>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/video-library/uploads/${encodeURIComponent(mediaAssetId)}`,
    {
      headers: storyWorkspaceHeaders(workspaceId),
      signal,
    }
  );
  assertStoryClipVideoFinalization(finalization, mediaAssetId);
  return finalization;
}

/**
 * Releases a Story clip upload that the browser abandoned before the server
 * accepted asynchronous finalization. This request deliberately owns its own
 * short timeout instead of reusing the already-aborted upload signal.
 */
export async function cancelStoryClipVideoUpload(
  workspaceId: string,
  projectId: string,
  mediaAssetId: string
): Promise<StoryClipVideoFinalization> {
  const finalization = await api.delete<StoryClipVideoFinalization>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/video-library/uploads/${encodeURIComponent(mediaAssetId)}`,
    {
      headers: storyWorkspaceHeaders(workspaceId),
      timeout: 5_000,
    }
  );
  assertStoryClipVideoFinalization(finalization, mediaAssetId);
  return finalization;
}

export async function waitForStoryClipVideoUploadFinalization(
  workspaceId: string,
  projectId: string,
  initial: StoryClipVideoFinalization,
  options: {
    signal?: AbortSignal;
    onStatus?: (finalization: StoryClipVideoFinalization) => void;
  } = {}
): Promise<StoryVideoLibraryItem> {
  let current = initial;
  let fallbackDelayMs = 1_500;
  throwIfStoryClipVideoPollAborted(options.signal);
  options.onStatus?.(current);

  while (current.status === "queued" || current.status === "processing") {
    const delayMs = Math.min(5_000, Math.max(250, current.pollAfterMs ?? fallbackDelayMs));
    await waitForStoryClipVideoPoll(delayMs, options.signal);
    fallbackDelayMs = Math.min(5_000, Math.ceil(delayMs * 1.5));
    current = await getStoryClipVideoUploadFinalization(
      workspaceId,
      projectId,
      current.mediaAssetId,
      options.signal
    );
    options.onStatus?.(current);
  }

  if (current.status === "ready" && current.item) {
    throwIfStoryClipVideoPollAborted(options.signal);
    return current.item;
  }
  throw new StoryClipVideoFinalizationError(
    current.error?.code ?? "STORY_VIDEO_FINALIZE_FAILED",
    current.error?.message ?? "The uploaded video could not be processed."
  );
}

/**
 * The workspace a story project lives in — the one Story Studio read that is
 * deliberately NOT workspace-scoped.
 *
 * A shared project link carries no workspace, so an invited member opens it with
 * their own personal workspace active and every scoped read misses. This answers
 * "which workspace should be active for this project?" so the studio can switch
 * before loading it. The server only answers for a caller who can already reach
 * the project and 404s for everyone else, so it never leaks a workspace id.
 *
 * No per-call workspace scope is sent. The ambient `x-fizz-workspace-id` that
 * `api` attaches to every request still rides along — here it holds the
 * invitee's own workspace, which is exactly the wrong answer — but the route
 * declares no `@Headers` and never reads it, so the resolve is unaffected by
 * whichever workspace happens to be active.
 */
export async function getStoryProjectWorkspace(projectId: string): Promise<string> {
  const resolved = await api.get<{ workspaceId: string }>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/workspace`
  );
  const workspaceId = resolved?.workspaceId;
  if (typeof workspaceId !== "string" || !workspaceId.trim()) {
    throw new Error("Story Studio API returned an invalid project workspace.");
  }
  return workspaceId;
}

export async function getStoryWorkbench(
  workspaceId: string,
  projectId: string,
  chapterId?: string
): Promise<StoryWorkbench> {
  const workbench = await api.get<StoryWorkbench>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/workbench`,
    {
      params: chapterId ? { chapterId } : undefined,
      headers: storyWorkspaceHeaders(workspaceId),
    }
  );
  if (!workbench || typeof workbench !== "object" || !("project" in workbench)) {
    throw new Error("Story Studio API returned an invalid workbench.");
  }
  assertProjectSummary(workbench.project);
  return workbench;
}

export async function createStoryChapter(
  workspaceId: string,
  projectId: string,
  input: { title: string }
): Promise<StoryChapter> {
  return api.post<StoryChapter>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function updateStoryChapter(
  workspaceId: string,
  projectId: string,
  chapterId: string,
  input: { title: string }
): Promise<StoryChapter> {
  return api.patch<StoryChapter>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function reorderStoryChapters(
  workspaceId: string,
  projectId: string,
  input: { expectedProjectVersion: number; chapterIds: string[] }
): Promise<StoryChapter[]> {
  return api.put<StoryChapter[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/order`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function archiveStoryChapter(
  workspaceId: string,
  projectId: string,
  chapterId: string
): Promise<StoryChapter> {
  return api.post<StoryChapter>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/archive`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function getStoryCanvasLayout(
  workspaceId: string,
  projectId: string,
  chapterId: string
): Promise<StoryCanvasLayout> {
  return api.get<StoryCanvasLayout>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/canvas-layout`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function getStoryCandidateAssets(
  workspaceId: string,
  projectId: string,
  signal?: AbortSignal
): Promise<StoryCandidateAsset[]> {
  const value = await api.get<unknown>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/candidate-assets`,
    { headers: storyWorkspaceHeaders(workspaceId), signal }
  );
  if (!Array.isArray(value)) {
    throw new Error("Story Studio API returned an invalid candidate asset collection.");
  }
  value.forEach(assertStoryCandidateAsset);
  return value;
}

export async function addStoryCandidateAsset(
  workspaceId: string,
  projectId: string,
  mediaAssetId: string
): Promise<StoryCandidateAsset> {
  const value = await api.put<unknown>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/candidate-assets/${encodeURIComponent(mediaAssetId)}`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
  assertStoryCandidateAsset(value);
  return value;
}

export async function removeStoryCandidateAsset(
  workspaceId: string,
  projectId: string,
  mediaAssetId: string
): Promise<{ mediaAssetId: string }> {
  return api.delete<{ mediaAssetId: string }>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/candidate-assets/${encodeURIComponent(mediaAssetId)}`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function putStoryCanvasLayout(
  workspaceId: string,
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
      headers: storyWorkspaceHeaders(workspaceId),
      ...request,
    }
  );
}

export async function updateStoryProject(
  workspaceId: string,
  projectId: string,
  input: {
    expectedProjectVersion: number;
    title?: string;
    summary?: string | null;
    coverAssetId?: string | null;
    defaultLocale?: string;
    visibility?: StoryVisibility;
    tags?: string[];
    frameProfile?: StoryFrameProfile;
    durationPreset?: StoryDurationPreset;
    visualStyle?: StoryVisualStyle;
    confirmCreativeProfile?: true;
  }
): Promise<StoryProjectSummary> {
  return api.patch<StoryProjectSummary>(`/aurora/story-projects/${encodeURIComponent(projectId)}`, {
    data: input,
    headers: storyWorkspaceHeaders(workspaceId),
  });
}

export async function archiveStoryProject(
  workspaceId: string,
  projectId: string,
  expectedProjectVersion: number
): Promise<void> {
  await api.post(`/aurora/story-projects/${encodeURIComponent(projectId)}/archive`, {
    data: { expectedProjectVersion },
    headers: storyWorkspaceHeaders(workspaceId),
  });
}

export async function putStoryDraft(
  workspaceId: string,
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
      headers: storyWorkspaceHeaders(workspaceId),
      ...request,
    }
  );
}

export async function createStoryBuild(
  workspaceId: string,
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
    headers: storyIdempotencyHeaders(workspaceId, idempotencyKey),
  });
}

export async function getStoryBuild(
  workspaceId: string,
  projectId: string,
  buildId: string
): Promise<StoryBuild> {
  return api.get<StoryBuild>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/builds/${encodeURIComponent(buildId)}`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function publishStoryBuild(
  workspaceId: string,
  projectId: string,
  buildId: string,
  input: { status: "published" | "draft"; setCurrent: boolean }
): Promise<ExperienceReleaseResult> {
  return api.post<ExperienceReleaseResult>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/builds/${encodeURIComponent(buildId)}/publish`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function getStoryExperienceCurrentRelease(
  workspaceId: string,
  projectId: string
): Promise<StoryExperienceCurrentRelease> {
  return api.get<StoryExperienceCurrentRelease>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/releases/current`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function getStoryWorkingPreview(
  workspaceId: string,
  projectId: string,
  chapterId?: string
): Promise<StoryWorkingPreview> {
  return api.get<StoryWorkingPreview>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/working-preview`,
    {
      ...(chapterId ? { params: { chapterId } } : {}),
      headers: storyWorkspaceHeaders(workspaceId),
    }
  );
}

export async function putStoryClipCurrentVideo(
  workspaceId: string,
  projectId: string,
  graphNodeId: string,
  input: {
    expectedDraftRevision: number;
    expectedSelectionVersion: number;
    assetId: string | null;
    variantId: string | null;
  }
): Promise<StoryClipVideoSummary> {
  return api.put<StoryClipVideoSummary>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(graphNodeId)}/current-video`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function listStoryReferenceSlots(
  workspaceId: string,
  projectId: string
): Promise<StoryReferenceSlot[]> {
  return api.get<StoryReferenceSlot[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function createStoryReferenceSlots(
  workspaceId: string,
  projectId: string,
  input: { slots: StoryReferenceSlotSpec[] },
  idempotencyKey: string
): Promise<StoryReferenceSlot[]> {
  return api.post<StoryReferenceSlot[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots`,
    { data: input, headers: storyIdempotencyHeaders(workspaceId, idempotencyKey) }
  );
}

export async function listStoryReferenceVersions(
  workspaceId: string,
  projectId: string,
  slotId: string
): Promise<StoryReferenceVersion[]> {
  return api.get<StoryReferenceVersion[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}/versions`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function updateStoryReferenceSlot(
  workspaceId: string,
  projectId: string,
  slotId: string,
  input: {
    expectedSlotVersion: number;
    slot: StoryReferenceSlotSpec;
  }
): Promise<StoryReferenceSlot> {
  return api.put<StoryReferenceSlot>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function createStoryReferenceVersion(
  workspaceId: string,
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
  idempotencyKey: string
): Promise<StoryReferenceVersion> {
  return api.post<StoryReferenceVersion>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}/versions`,
    { data: input, headers: storyIdempotencyHeaders(workspaceId, idempotencyKey) }
  );
}

export async function reviewStoryReferenceVersion(
  workspaceId: string,
  projectId: string,
  slotId: string,
  referenceVersionId: string,
  input: {
    expectedReviewRevision: number;
    decision: StoryReviewDecision;
    checklist: StoryReferenceReviewChecklist;
    comment?: string;
  }
): Promise<{ reference: StoryReferenceVersion; review: StoryReview }> {
  return api.post<{ reference: StoryReferenceVersion; review: StoryReview }>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}/versions/${encodeURIComponent(referenceVersionId)}/reviews`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function approveStoryReferenceVersion(
  workspaceId: string,
  projectId: string,
  slotId: string,
  input: {
    expectedSlotVersion: number;
    referenceVersionId: string;
    approveReviewId: string;
  }
): Promise<StoryReferenceSlot> {
  return api.post<StoryReferenceSlot>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/reference-slots/${encodeURIComponent(slotId)}/approval`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
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
      project.visualStyle !== "cinematic_realism" &&
      project.visualStyle !== "stylized_3d" &&
      project.visualStyle !== "graphic_novel" &&
      project.visualStyle !== "anime_cinematic") ||
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

function assertStoryVideoLibraryItem(value: unknown): asserts value is StoryVideoLibraryItem {
  if (!value || typeof value !== "object") {
    throw new Error("Story Studio API returned an invalid video library item.");
  }
  const item = value as Partial<StoryVideoLibraryItem>;
  const asset = item.asset;
  if (
    !asset ||
    typeof asset !== "object" ||
    asset.kind !== "video" ||
    asset.status !== "ready" ||
    !["unreviewed", "approved", "flagged", "blocked"].includes(asset.moderationStatus) ||
    !nonEmptyString(asset.id) ||
    !nonEmptyString(asset.contentType) ||
    !asset.contentType.startsWith("video/") ||
    !nullablePositiveInteger(asset.width) ||
    !nullablePositiveInteger(asset.height) ||
    !nullableNonNegativeNumber(asset.durationSeconds) ||
    !nullableNonEmptyString(asset.checksumSha256) ||
    !nullableNonEmptyString(asset.previewUrl) ||
    !nonEmptyString(item.variantId) ||
    item.variantKey !== "original" ||
    !nonEmptyString(item.contentType) ||
    !item.contentType.startsWith("video/") ||
    !nullablePositiveInteger(item.width) ||
    !nullablePositiveInteger(item.height) ||
    !nullableNonNegativeNumber(item.durationSeconds) ||
    !nullableNonEmptyString(item.checksumSha256) ||
    !validIsoTimestamp(item.createdAt)
  ) {
    throw new Error("Story Studio API returned an invalid video library item.");
  }
}

function assertStoryClipVideoFinalization(
  value: unknown,
  expectedMediaAssetId: string
): asserts value is StoryClipVideoFinalization {
  if (!value || typeof value !== "object") {
    throw new Error("Story Studio API returned an invalid video finalization state.");
  }
  const finalization = value as Partial<StoryClipVideoFinalization>;
  const pending = finalization.status === "queued" || finalization.status === "processing";
  const terminalFailure =
    finalization.status === "failed" ||
    finalization.status === "expired" ||
    finalization.status === "cancelled";
  if (
    finalization.mediaAssetId !== expectedMediaAssetId ||
    (!pending && finalization.status !== "ready" && !terminalFailure) ||
    (pending &&
      (!Number.isFinite(finalization.pollAfterMs) ||
        (finalization.pollAfterMs ?? 0) <= 0 ||
        finalization.item !== null ||
        finalization.error !== null)) ||
    (!pending && finalization.pollAfterMs !== null)
  ) {
    throw new Error("Story Studio API returned an invalid video finalization state.");
  }

  if (finalization.status === "ready") {
    if (finalization.error !== null) {
      throw new Error("Story Studio API returned an invalid video finalization state.");
    }
    assertStoryVideoLibraryItem(finalization.item);
    return;
  }

  if (
    terminalFailure &&
    (finalization.item !== null ||
      !finalization.error ||
      !nonEmptyString(finalization.error.code) ||
      !nonEmptyString(finalization.error.message))
  ) {
    throw new Error("Story Studio API returned an invalid video finalization state.");
  }
}

function waitForStoryClipVideoPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const abort = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException("Request aborted", "AbortError")
      );
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function throwIfStoryClipVideoPollAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Request aborted", "AbortError");
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
