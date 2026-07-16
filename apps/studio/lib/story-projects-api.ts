import { api, ApiRequestError } from "@/lib/api";

/**
 * Product Story Studio client.
 *
 * StoryProject is a sovereign project root. It is scoped to the active
 * workspace by the API client's x-fizz-workspace-id header and never borrows a
 * PlatformProject id. Mutable drafts use revision CAS; generation and release
 * records capture server-owned immutable input snapshots automatically.
 */

export const INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION = "interactive-film-draft-v2" as const;
export const STORY_CANVAS_LAYOUT_SCHEMA_VERSION = "story-canvas-layout-v1" as const;

export type StoryFormat = "text_adventure" | "interactive_film" | "narrative_rpg";
export type StoryProjectStatus = "active" | "archived";
export type StoryVisibility = "private" | "unlisted" | "public";
export type StoryFrameProfile = "landscape_16_9" | "portrait_9_16";

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

/**
 * One reusable, ready video variant from the active project's workspace.
 *
 * The asset remains the durable history record; the variant fields describe
 * the exact playable original that can be bound as a clip or trailer's current
 * video without creating another generation.
 */
export interface StoryVideoLibraryItem {
  asset: MediaAssetSummary;
  variantId: string;
  variantKey: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  checksumSha256: string;
  createdAt: string;
}

export interface StoryRevisionSummary {
  id: string;
  number: number;
  sourceDraftRevision: number;
  schemaVersion: string;
  contentHash: string;
  label: string | null;
  source: "creator" | "import";
  createdByUserId: string;
  createdAt: string;
}

export interface StoryDeployment {
  environment: "preview" | "production";
  releaseId: string;
  status: "active" | "offline";
  version: number;
  deployedByUserId: string | null;
  deployedAt: string | null;
  offlinedByUserId: string | null;
  offlinedAt: string | null;
}

export interface StoryProjectProductionSummary {
  referenceSlotCount: number;
  approvedReferenceCount: number;
  clipCount: number;
  currentVideoCount: number;
  generatingClipCount: number;
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
  format: StoryFormat;
  frameProfile: StoryFrameProfile;
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
  activeRevision: StoryRevisionSummary | null;
  publishRevision: number;
  deployments: StoryDeployment[];
  production: StoryProjectProductionSummary;
  capabilities: StoryCapability[];
  createdAt: string;
  updatedAt: string;
}

export type StoryScalarValue = string | number | boolean | null;

export type FilmCondition =
  | { kind: "flag"; flag: string; equals: boolean }
  | {
      kind: "variable";
      key: string;
      operator: "equals" | "not_equals" | "greater_than" | "at_least" | "less_than" | "at_most";
      value: StoryScalarValue;
    }
  | { kind: "relationship-at-least"; characterId: string; value: number }
  | { kind: "all" | "any"; conditions: FilmCondition[] }
  | { kind: "not"; condition: FilmCondition };

export type FilmEffect =
  | { kind: "set_variable"; key: string; value: StoryScalarValue }
  | { kind: "increment_variable"; key: string; amount: number }
  | { kind: "set_flag"; flag: string; value: boolean }
  | { kind: "adjust_relationship"; characterId: string; amount: number }
  | { kind: "unlock_ending"; endingId: string };

export interface StoryGraphChoice {
  choiceId: string;
  label: Record<string, string>;
  accessibilityLabel?: Record<string, string>;
  visibleWhen?: FilmCondition;
  effects: FilmEffect[];
  nextNodeId: string;
  afterSelect: { kind: "immediate" } | { kind: "play"; reactionClipKey: string };
}

export interface StoryAutoRoute {
  nextNodeId: string;
  when?: FilmCondition;
  priority: number;
}

export type StoryGraphNode =
  | {
      kind: "clip";
      nodeId: string;
      clipKey: string;
      exit:
        | { kind: "auto"; nextNodeId: string | null }
        | {
            kind: "choice";
            decisionId: string;
            prompt: Record<string, string>;
            trigger: { kind: "media-ended" } | { kind: "timecode"; atMs: number };
            choices: StoryGraphChoice[];
          }
        | { kind: "checkpoint"; nextNodeId: string }
        | { kind: "ending"; endingId: string };
    }
  | { kind: "router"; nodeId: string; exit: { kind: "auto"; routes: StoryAutoRoute[] } };

export type StoryClipPromptGenerationControl =
  | { mode: "omni_reference" }
  | { mode: "frame_lock"; frameMode: "first_frame" | "first_last_frame" };

export type StoryClipReferenceRole =
  | "subject"
  | "location"
  | "prop"
  | "style"
  | "first_frame"
  | "last_frame"
  | "omni_reference"
  | "other";

export interface StoryClipPromptBeat {
  id: string;
  startMs: number;
  endMs: number;
  visual: string;
  camera: string;
  action: string;
  performance: string;
  emotion: string;
  dialogue: string;
  audio: string;
  endState: string;
  continuity: string;
}

export interface StoryClipPromptDraft {
  graphNodeId: string;
  clipKey: string;
  title: string;
  description: string;
  targetDurationMs: number;
  generationControl: StoryClipPromptGenerationControl;
  masterDirection: string;
  referenceRoleNotes: Array<{
    id: string;
    role: StoryClipReferenceRole;
    referenceId: string;
    note: string;
  }>;
  emotionalArc: string;
  beats: StoryClipPromptBeat[];
  negativeConstraints: string[];
  continuityNotes: string[];
}

export type StoryTrailerPromptDraft = Omit<StoryClipPromptDraft, "graphNodeId" | "clipKey">;

export interface InteractiveFilmDraftContent {
  storyBible: {
    logline: string;
    synopsis: string;
    worldview: string;
    storyRules: string[];
    characters: Array<{
      id: string;
      name: Record<string, string>;
      role: string;
      summary: string;
      playable: boolean;
      continuityRules: string[];
    }>;
    locations: string[];
    props: string[];
    stateVariables: Array<
      | { key: string; type: "boolean"; initialValue: boolean }
      | {
          key: string;
          type: "number";
          initialValue: number;
          minimum?: number;
          maximum?: number;
        }
      | {
          key: string;
          type: "string";
          initialValue: string;
          allowedValues?: string[];
        }
    >;
    endings: Array<{
      id: string;
      title: Record<string, string>;
      summary: Record<string, string>;
      kind: "truth" | "bond" | "echo" | "failure" | "hidden" | "custom";
    }>;
  };
  graph: { entryNodeId: string | null; nodes: StoryGraphNode[] };
  clipPrompts: StoryClipPromptDraft[];
  trailerPrompt: StoryTrailerPromptDraft | null;
  productionNotes: string[];
}

export interface StoryDraft {
  projectId: string;
  format: "interactive_film";
  schemaVersion: typeof INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION;
  content: InteractiveFilmDraftContent;
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
  schemaVersion: typeof STORY_CANVAS_LAYOUT_SCHEMA_VERSION;
  nodePositions: Record<string, StoryCanvasPosition>;
  revision: number;
  updatedByUserId: string;
  updatedBySessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryRevision extends StoryRevisionSummary {
  projectId: string;
  format: "interactive_film";
  content: InteractiveFilmDraftContent;
}

export type FilmGenerationControl =
  | { mode: "omni_reference" }
  | { mode: "frame_lock"; frameMode: "first_frame" | "first_last_frame" };

export interface FilmSpec {
  projectId: string;
  revisionId: string;
  runtimeSchemaVersion: 1;
  frame: {
    aspectRatio: "16:9" | "9:16";
    width: number;
    height: number;
    framesPerSecond: { numerator: number; denominator: number };
  };
  audioSampleRateHz: 44100 | 48000;
  duration: {
    targetMs: number;
    toleranceMs: number;
    maxContinuousMs: number;
    maxGeneratedClipMs: number;
  };
  targets: { clipCount: number; choiceCount: number; endingCount: number };
  locales: { defaultLocale: string; enabledLocales: string[] };
  generation: { defaultCanonicalModelId: string };
  version: number;
  productionRevision: number;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type FilmVideoGenerationStatus =
  | "queued"
  | "running"
  | "processing"
  | "ready"
  | "failed"
  | "cancelled";

export interface FilmCurrentVideo {
  asset: MediaAssetSummary;
  variantId: string;
  sourceGenerationId: string | null;
  specHash: string | null;
  inputHash: string | null;
  checksumSha256: string;
  technicalChecks: FilmTechnicalCheck[];
  revision: number;
  setByUserId: string | null;
  setAt: string;
  outdated: boolean;
}

export interface FilmVideoGeneration {
  id: string;
  projectId: string;
  revisionId: string;
  target: { kind: "clip"; clipId: string } | { kind: "trailer"; trailerId: string };
  number: number;
  version: number;
  aiJobId: string;
  aiJobOutputId: string | null;
  status: FilmVideoGenerationStatus;
  specHash: string;
  inputHash: string;
  promptSnapshot: Record<string, unknown>;
  generationConfig: Record<string, unknown>;
  modelSnapshot: Record<string, unknown>;
  outputAsset: MediaAssetSummary | null;
  outputVariantId: string | null;
  outputChecksumSha256: string | null;
  technicalChecks: FilmTechnicalCheck[];
  error: Record<string, unknown> | null;
  createdByUserId: string;
  queuedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  cancelledAt: string | null;
  supersededAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface FilmClipSummary {
  id: string;
  key: string;
  graphNodeId: string;
  kind: "opening" | "scene" | "ending";
  title: string;
  description: string;
  rank: number;
  targetDurationMs: number;
  generationControl: FilmGenerationControl;
  prompt: {
    masterPrompt: string;
    negativeConstraints: string[];
    timeline: Array<{
      startMs: number;
      endMs: number;
      visual: string;
      camera: string;
      action: string;
      performance?: string;
      emotion?: string;
      dialogue?: string;
      audio?: string;
      endState?: string;
      continuity?: string;
    }>;
  };
  dialogueWindows: Array<{
    id: string;
    speakerId?: string;
    source: "on_screen" | "voice_over" | "off_screen";
    startMs: number;
    endMs: number;
    text: Record<string, string>;
    delivery?: string;
  }>;
  outputContract: {
    aspectRatio: "16:9" | "9:16";
    width: number;
    height: number;
    durationMs: number;
    durationToleranceMs: number;
    framesPerSecond: { numerator: number; denominator: number };
    audio: "none" | "embedded" | "separate";
  };
  continuityNotes: string[];
  version: number;
  productionInputHash: string | null;
  referenceBindings: FilmClipReferenceBinding[];
  currentVideo: FilmCurrentVideo | null;
  currentVideoRevision: number;
  generation: FilmVideoGeneration | null;
  updatedAt: string;
}

export interface FilmTrailerSummary {
  schemaVersion: 1;
  id: string;
  projectId: string;
  revisionId: string;
  title: string;
  description: string;
  targetDurationMs: number;
  generationControl: FilmGenerationControl;
  referenceRoleNotes: StoryClipPromptDraft["referenceRoleNotes"];
  prompt: FilmClipSummary["prompt"];
  outputContract: FilmClipSummary["outputContract"];
  continuityNotes: string[];
  version: number;
  specHash: string;
  productionInputHash: string | null;
  referenceBindings: FilmClipReferenceBinding[];
  currentVideo: FilmCurrentVideo | null;
  currentVideoRevision: number;
  generation: FilmVideoGeneration | null;
  createdAt: string;
  updatedAt: string;
}

export type FilmClipReferenceRole = "omni" | "first_frame" | "last_frame" | "continuity" | "style";

export interface FilmClipReferenceBinding {
  id: string;
  referenceSlotId: string;
  role: FilmClipReferenceRole;
  rank: number;
  required: boolean;
  approvedReferenceVersionId: string | null;
}

export type FilmReferenceKind =
  | "character"
  | "location"
  | "prop"
  | "graphic"
  | "style"
  | "join_frame"
  | "first_frame"
  | "last_frame";

export interface FilmReferenceSlotSpec {
  key: string;
  kind: FilmReferenceKind;
  label: string;
  description: string;
  required: boolean;
  rank: number;
}

export interface FilmReferenceSlot {
  id: string;
  projectId: string;
  revisionId: string;
  key: string;
  kind: FilmReferenceKind;
  label: string;
  description: string;
  required: boolean;
  rank: number;
  version: number;
  status: "empty" | "candidate" | "approved" | "invalidated";
  approvedVersionId: string | null;
  versions: FilmReferenceVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface FilmReferenceVersion {
  id: string;
  slotId: string;
  number: number;
  source: "upload" | "ai_job" | "import" | "generation_frame";
  aiJobId: string | null;
  aiJobOutputId: string | null;
  sourceGenerationId: string | null;
  sourceFrameIndex: number | null;
  sourceOutputChecksumSha256: string | null;
  asset: MediaAssetSummary;
  promptSnapshot: Record<string, unknown> | null;
  configSnapshot: Record<string, unknown> | null;
  checksumSha256: string;
  reviewRevision: number;
  approved: boolean;
  createdByUserId: string;
  createdAt: string;
}

export interface FilmReferenceReviewChecklist {
  technical: FilmReviewChecklistValue;
  identityContinuity: FilmReviewChecklistValue;
  rights: FilmReviewChecklistValue;
  safety: FilmReviewChecklistValue;
}

export type FilmBuildStatus =
  | "queued"
  | "validating"
  | "compiling"
  | "ready"
  | "failed"
  | "cancelled";

export type FilmBuildScope =
  | { kind: "full" }
  | { kind: "subgraph"; entryClipId: string; maxDepth?: number };

export interface FilmBuildDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  entityType:
    | "revision"
    | "clip"
    | "reference"
    | "generation"
    | "choice"
    | "ending"
    | "asset"
    | null;
  entityId: string | null;
}

export interface FilmBuildPathReport {
  enumeratedPathCount: number;
  reachableEndingIds: string[];
  unreachableNodeIds: string[];
  ambiguousPathCount: number;
  durationMinMs: number;
  durationMaxMs: number;
}

export interface FrozenStoryAsset {
  logicalKey: string;
  assetId: string;
  variantId: string;
  checksumSha256: string;
  contentType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: string | null;
}

export interface FilmBuildAsset extends FrozenStoryAsset {
  id: string;
  buildId: string;
  clipId: string | null;
  role: string;
}

export interface FilmBuildSummary {
  id: string;
  number: number;
  profile: "preview" | "production";
  scope: FilmBuildScope;
  status: FilmBuildStatus;
  sourceProductionRevision: number;
  diagnostics: FilmBuildDiagnostic[];
  createdAt: string;
  completedAt: string | null;
}

export interface FilmBuild {
  id: string;
  projectId: string;
  revisionId: string;
  number: number;
  version: number;
  profile: "preview" | "production";
  scope: FilmBuildScope;
  status: FilmBuildStatus;
  sourceProductionRevision: number;
  inputHash: string;
  inputManifestHash: string;
  runtimeSchemaVersion: 1;
  runtimeJson: Record<string, unknown> | null;
  runtimeHash: string | null;
  assets: FilmBuildAsset[];
  diagnostics: FilmBuildDiagnostic[];
  pathReport: FilmBuildPathReport | null;
  createdByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Ephemeral playtest compiled from the saved authoring head.
 *
 * Unlike FilmBuild this is not a release artifact and does not freeze the
 * project. Every playable node resolves its single current video binding.
 */
export interface StoryWorkingPreview {
  draftRevision: number;
  contentHash: string;
  runtime: Record<string, unknown> | null;
  diagnostics: FilmBuildDiagnostic[];
  pathReport: FilmBuildPathReport | null;
  sources: Array<{
    graphNodeId: string;
    assetId: string;
    variantId: string;
    sourceGenerationId: string | null;
    currentVideoRevision: number;
    selection: "current";
  }>;
}
export type FilmReviewDecision = "approve" | "reject" | "request_changes";
export type FilmReviewChecklistValue = "pass" | "fail" | "na";

export interface FilmTechnicalCheck {
  key: string;
  status: "pending" | "passed" | "failed";
  message: string | null;
}

export interface PreparedDraftFilmClip {
  draftRevision: number;
  revisionId: string;
  productionRevision: number;
  clip: FilmClipSummary;
}

export interface FilmReview {
  id: string;
  decision: FilmReviewDecision;
  checklist: Record<string, FilmReviewChecklistValue>;
  comment: string | null;
  reviewerUserId: string;
  createdAt: string;
}

export interface StoryWorkbench {
  project: StoryProjectSummary;
  draft: StoryDraft;
  selectedRevision: StoryRevision | null;
  film: {
    productionRevision: number;
    spec: FilmSpec | null;
    defaultModel?: {
      id: string;
      slug: string;
      displayName: string;
      generationModes: string[];
    } | null;
    trailer: FilmTrailerSummary | null;
    clips: FilmClipSummary[];
    references: FilmReferenceSlot[];
    latestBuild: FilmBuildSummary | null;
  } | null;
}

export interface CreateStoryProjectInput {
  format: "interactive_film";
  frameProfile: StoryFrameProfile;
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
  if (!idempotencyKey.trim()) throw new Error("Video generation requires an idempotency key.");
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
    format?: StoryFormat;
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

export async function listStoryVideoLibrary(
  workspaceId: string,
  projectId: string,
  query: { cursor?: string; limit?: number } = {}
): Promise<CursorPage<StoryVideoLibraryItem>> {
  const page = await api.get<CursorPage<StoryVideoLibraryItem>>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/video-library`,
    {
      params: query,
      headers: storyWorkspaceHeaders(workspaceId),
    }
  );
  if (!page || !Array.isArray(page.items)) {
    throw new Error("Story Studio API returned an invalid video library page.");
  }
  page.items.forEach(assertStoryVideoLibraryItem);
  if (page.nextCursor !== null && typeof page.nextCursor !== "string") {
    throw new Error("Story Studio API returned an invalid video library cursor.");
  }
  return page;
}

export async function getStoryWorkbench(
  workspaceId: string,
  projectId: string,
  revisionId?: string
): Promise<StoryWorkbench> {
  const workbench = await api.get<StoryWorkbench>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/workbench`,
    {
      params: revisionId ? { revisionId } : undefined,
      headers: storyWorkspaceHeaders(workspaceId),
    }
  );
  if (!workbench || typeof workbench !== "object" || !("project" in workbench)) {
    throw new Error("Story Studio API returned an invalid workbench.");
  }
  assertProjectSummary(workbench.project);
  return workbench;
}

export async function getStoryDraft(workspaceId: string, projectId: string): Promise<StoryDraft> {
  return api.get<StoryDraft>(`/aurora/story-projects/${encodeURIComponent(projectId)}/draft`, {
    headers: storyWorkspaceHeaders(workspaceId),
  });
}

export async function getStoryCanvasLayout(
  workspaceId: string,
  projectId: string
): Promise<StoryCanvasLayout> {
  return api.get<StoryCanvasLayout>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/canvas-layout`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function putStoryCanvasLayout(
  workspaceId: string,
  projectId: string,
  input: {
    expectedRevision: number;
    nodePositions: Record<string, StoryCanvasPosition>;
    sessionId: string;
  }
): Promise<StoryCanvasLayout> {
  return api.put<StoryCanvasLayout>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/canvas-layout`,
    {
      data: { schemaVersion: STORY_CANVAS_LAYOUT_SCHEMA_VERSION, ...input },
      headers: storyWorkspaceHeaders(workspaceId),
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
  input: {
    expectedRevision: number;
    content: InteractiveFilmDraftContent;
    sessionId: string;
  },
  request?: Pick<RequestInit, "keepalive">
): Promise<StoryDraft> {
  return api.put<StoryDraft>(`/aurora/story-projects/${encodeURIComponent(projectId)}/draft`, {
    data: { schemaVersion: INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION, ...input },
    headers: storyWorkspaceHeaders(workspaceId),
    ...request,
  });
}

export async function listFilmBuilds(
  workspaceId: string,
  projectId: string,
  query: {
    profile?: "preview" | "production";
    cursor?: string;
    limit?: number;
  } = {}
): Promise<CursorPage<FilmBuildSummary>> {
  return api.get<CursorPage<FilmBuildSummary>>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/builds`,
    { params: query, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function createFilmBuild(
  workspaceId: string,
  projectId: string,
  input: {
    revisionId: string;
    expectedProductionRevision: number;
    profile: "preview" | "production";
    scope: FilmBuildScope;
  },
  idempotencyKey: string
): Promise<FilmBuild> {
  return api.post<FilmBuild>(`/aurora/story-projects/${encodeURIComponent(projectId)}/builds`, {
    data: input,
    headers: storyIdempotencyHeaders(workspaceId, idempotencyKey),
  });
}

export async function getFilmBuild(
  workspaceId: string,
  projectId: string,
  buildId: string
): Promise<FilmBuild> {
  return api.get<FilmBuild>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/builds/${encodeURIComponent(buildId)}`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function cancelFilmBuild(
  workspaceId: string,
  projectId: string,
  buildId: string,
  input: { expectedBuildVersion: number }
): Promise<FilmBuild> {
  return api.post<FilmBuild>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/builds/${encodeURIComponent(buildId)}/cancel`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function prepareFilmClip(
  workspaceId: string,
  projectId: string,
  graphNodeId: string,
  input: {
    expectedDraftRevision: number;
    modelId?: string;
  }
): Promise<PreparedDraftFilmClip> {
  return api.post<PreparedDraftFilmClip>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(graphNodeId)}/prepare`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function createFilmClipGeneration(
  workspaceId: string,
  projectId: string,
  graphNodeId: string,
  input: {
    expectedDraftRevision: number;
    modelId?: string;
    variationNote?: string;
    seed?: string;
  },
  idempotencyKey: string
): Promise<FilmVideoGeneration> {
  return api.post<FilmVideoGeneration>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(graphNodeId)}/generations`,
    { data: input, headers: storyIdempotencyHeaders(workspaceId, idempotencyKey) }
  );
}

export async function createFilmRevisionClipGeneration(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  clipId: string,
  input: {
    expectedClipVersion: number;
    modelId?: string;
    variationNote?: string;
    seed?: string;
  },
  idempotencyKey: string
): Promise<FilmVideoGeneration> {
  return api.post<FilmVideoGeneration>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/clips/${encodeURIComponent(clipId)}/generations`,
    { data: input, headers: storyIdempotencyHeaders(workspaceId, idempotencyKey) }
  );
}

export async function getStoryWorkingPreview(
  workspaceId: string,
  projectId: string,
  expectedDraftRevision: number
): Promise<StoryWorkingPreview> {
  return api.get<StoryWorkingPreview>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/working-preview`,
    {
      params: { expectedDraftRevision },
      headers: storyWorkspaceHeaders(workspaceId),
    }
  );
}

export async function getFilmVideoGeneration(
  workspaceId: string,
  projectId: string,
  generationId: string
): Promise<FilmVideoGeneration> {
  return api.get<FilmVideoGeneration>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function cancelFilmVideoGeneration(
  workspaceId: string,
  projectId: string,
  generationId: string,
  input: { expectedGenerationVersion: number }
): Promise<FilmVideoGeneration> {
  return api.post<FilmVideoGeneration>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/cancel`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function retryFilmVideoGeneration(
  workspaceId: string,
  projectId: string,
  generationId: string,
  input: { expectedGenerationVersion: number; variationNote?: string },
  idempotencyKey: string
): Promise<FilmVideoGeneration> {
  return api.post<FilmVideoGeneration>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/generations/${encodeURIComponent(generationId)}/retry`,
    { data: input, headers: storyIdempotencyHeaders(workspaceId, idempotencyKey) }
  );
}

export async function putFilmClipCurrentVideo(
  workspaceId: string,
  projectId: string,
  graphNodeId: string,
  input: {
    expectedDraftRevision: number;
    expectedCurrentVideoRevision: number;
    assetId: string | null;
    variantId: string | null;
  }
): Promise<FilmClipSummary> {
  return api.put<FilmClipSummary>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(graphNodeId)}/current-video`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function listFilmReferenceSlots(
  workspaceId: string,
  projectId: string,
  revisionId: string
): Promise<FilmReferenceSlot[]> {
  return api.get<FilmReferenceSlot[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/reference-slots`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function createFilmReferenceSlots(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  input: { expectedProductionRevision: number; slots: FilmReferenceSlotSpec[] }
): Promise<FilmReferenceSlot[]> {
  return api.post<FilmReferenceSlot[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/reference-slots`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function listFilmReferenceVersions(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  slotId: string
): Promise<FilmReferenceVersion[]> {
  return api.get<FilmReferenceVersion[]>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/reference-slots/${encodeURIComponent(slotId)}/versions`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function updateFilmReferenceSlot(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  slotId: string,
  input: {
    expectedVersion: number;
    expectedProductionRevision: number;
    slot: FilmReferenceSlotSpec;
  }
): Promise<FilmReferenceSlot> {
  return api.put<FilmReferenceSlot>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/reference-slots/${encodeURIComponent(slotId)}`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function createFilmReferenceVersion(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  slotId: string,
  input: {
    expectedSlotVersion: number;
    assetId: string;
    source: "upload" | "import";
    promptSnapshot?: Record<string, unknown>;
    configSnapshot?: Record<string, unknown>;
  },
  idempotencyKey: string
): Promise<FilmReferenceVersion> {
  return api.post<FilmReferenceVersion>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/reference-slots/${encodeURIComponent(slotId)}/versions`,
    { data: input, headers: storyIdempotencyHeaders(workspaceId, idempotencyKey) }
  );
}

export async function reviewFilmReferenceVersion(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  slotId: string,
  referenceVersionId: string,
  input: {
    expectedReviewRevision: number;
    decision: FilmReviewDecision;
    checklist: FilmReferenceReviewChecklist;
    comment?: string;
  }
): Promise<{ reference: FilmReferenceVersion; review: FilmReview }> {
  return api.post<{ reference: FilmReferenceVersion; review: FilmReview }>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/reference-slots/${encodeURIComponent(slotId)}/versions/${encodeURIComponent(referenceVersionId)}/reviews`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function approveFilmReferenceVersion(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  slotId: string,
  input: {
    expectedSlotVersion: number;
    expectedProductionRevision: number;
    referenceVersionId: string;
    approveReviewId: string;
  }
): Promise<FilmReferenceSlot> {
  return api.post<FilmReferenceSlot>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/reference-slots/${encodeURIComponent(slotId)}/approval`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function putFilmClipReferences(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  clipId: string,
  input: {
    expectedClipVersion: number;
    expectedProductionRevision: number;
    bindings: Array<{
      referenceSlotId: string;
      role: FilmClipReferenceRole;
      rank: number;
      required: boolean;
    }>;
  }
): Promise<{
  clipId: string;
  clipVersion: number;
  productionRevision: number;
  bindings: FilmClipReferenceBinding[];
}> {
  return api.put<{
    clipId: string;
    clipVersion: number;
    productionRevision: number;
    bindings: FilmClipReferenceBinding[];
  }>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/clips/${encodeURIComponent(clipId)}/references`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function getFilmTrailer(
  workspaceId: string,
  projectId: string,
  revisionId: string
): Promise<FilmTrailerSummary> {
  return api.get<FilmTrailerSummary>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/trailer`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function putFilmTrailerReferences(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  input: {
    expectedTrailerVersion: number;
    bindings: Array<{
      referenceSlotId: string;
      role: FilmClipReferenceRole;
      rank: number;
      required: boolean;
    }>;
  }
): Promise<{
  trailerId: string;
  trailerVersion: number;
  currentVideoRevision: number;
  bindings: FilmClipReferenceBinding[];
}> {
  return api.put<{
    trailerId: string;
    trailerVersion: number;
    currentVideoRevision: number;
    bindings: FilmClipReferenceBinding[];
  }>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/trailer/references`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function createFilmTrailerGeneration(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  input: {
    expectedTrailerVersion: number;
    modelId?: string;
    variationNote?: string;
    seed?: string;
  },
  idempotencyKey: string
): Promise<FilmVideoGeneration> {
  return api.post<FilmVideoGeneration>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/trailer/generations`,
    { data: input, headers: storyIdempotencyHeaders(workspaceId, idempotencyKey) }
  );
}

export async function getFilmTrailerGeneration(
  workspaceId: string,
  projectId: string,
  generationId: string
): Promise<FilmVideoGeneration> {
  return api.get<FilmVideoGeneration>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/trailer-generations/${encodeURIComponent(generationId)}`,
    { headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function retryFilmTrailerGeneration(
  workspaceId: string,
  projectId: string,
  generationId: string,
  input: { expectedGenerationVersion: number; variationNote?: string },
  idempotencyKey: string
): Promise<FilmVideoGeneration> {
  return api.post<FilmVideoGeneration>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/trailer-generations/${encodeURIComponent(generationId)}/retry`,
    { data: input, headers: storyIdempotencyHeaders(workspaceId, idempotencyKey) }
  );
}

export async function cancelFilmTrailerGeneration(
  workspaceId: string,
  projectId: string,
  generationId: string,
  input: { expectedGenerationVersion: number }
): Promise<FilmVideoGeneration> {
  return api.post<FilmVideoGeneration>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/trailer-generations/${encodeURIComponent(generationId)}/cancel`,
    { data: input, headers: storyWorkspaceHeaders(workspaceId) }
  );
}

export async function putFilmTrailerCurrentVideo(
  workspaceId: string,
  projectId: string,
  revisionId: string,
  input: {
    expectedCurrentVideoRevision: number;
    assetId: string | null;
    variantId: string | null;
  }
): Promise<FilmTrailerSummary> {
  return api.put<FilmTrailerSummary>(
    `/aurora/story-projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/trailer/current-video`,
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
  if (error instanceof ApiRequestError && error.message.trim()) return error.message;
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
  if (
    project.format !== "interactive_film" ||
    (project.frameProfile !== "landscape_16_9" && project.frameProfile !== "portrait_9_16") ||
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
    !nonEmptyString(item.checksumSha256) ||
    !validIsoTimestamp(item.createdAt)
  ) {
    throw new Error("Story Studio API returned an invalid video library item.");
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function nullableNonEmptyString(value: unknown): value is string | null {
  return value === null || nonEmptyString(value);
}

function nullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function nullablePositiveInteger(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value > 0)
  );
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}
