"use client";

import {
  estimateProductModelPoints,
  firstBlockingValidationMessage,
  hasBlockingValidationIssues,
  validateGenerationInput,
  withAttachedUiOptions,
  type AiObjectSchema,
  type AiProductPricingPolicy,
  type MediaRefSnapshot,
  type ValidationIssue,
} from "@repo/shared";
import { api } from "@/lib/api";

export type { MediaRefSnapshot, ValidationIssue };

export type FizzAiJobType = "image" | "video";
export type FizzAiGenerationMode =
  | "first_last_frame_to_video"
  | "image_to_image"
  | "image_to_panorama"
  | "image_to_video"
  | "inpainting"
  | "multi_angle"
  | "multimodal_to_video"
  | "outpainting"
  | "relight"
  | "remove_background"
  | "text_to_image"
  | "text_to_video"
  | "upscale"
  | "video_to_video";

/** Media kind of a reference upload — mirrors the catalog's `x-ui.mediaKind`. */
export type FizzAiReferenceKind = "image" | "video" | "audio";

type FizzAiSchemaProperty = {
  default?: unknown;
  enum?: unknown[];
  maximum?: number;
  maxLength?: number;
  minimum?: number;
  multipleOf?: number;
  maxItems?: number;
  minItems?: number;
  items?: FizzAiSchemaProperty;
  properties?: Record<string, FizzAiSchemaProperty>;
  required?: string[];
  type?: string;
  title?: string;
  /** Schema-driven UI hint emitted by the catalog (control type, grouping, order). */
  "x-ui"?: {
    control?: string;
    group?: string;
    order?: number;
    unit?: string;
    importance?: string;
    /**
     * Explicit option list (preferred). `value` is stored/submitted; `label` /
     * `labelKey` is display-only. When absent, UI falls back to bare `enum`.
     */
    options?: Array<{
      value: string | number | boolean;
      label?: string;
      labelKey?: string;
    }>;
    /** Upload constraint metadata (reference upload fields). */
    accept?: string;
    mediaKind?: FizzAiReferenceKind;
    acceptFormats?: string[];
    maxFileSizeMb?: number;
    maxCombinedFileSizeMb?: number;
    minCombinedDurationSeconds?: number;
    maxCombinedDurationSeconds?: number;
    minItemDurationSeconds?: number;
    maxItemDurationSeconds?: number;
    resolutionBand?: string;
    audioRequiresVisual?: boolean;
    promptRefPrefix?: string;
    maxTotalFiles?: number;
  };
};

export type FizzAiInputSchema = {
  additionalProperties?: boolean;
  properties?: Record<string, FizzAiSchemaProperty>;
  required?: string[];
  type?: "object";
};

export interface FizzAiModel {
  id: string;
  type: FizzAiJobType;
  name: string;
  description?: string;
  provider?: string;
  family?: string;
  /** The company that makes the model (ByteDance / Google / …). "Providers" filter axis. */
  vendor?: string;
  enabled: boolean;
  disabledReason?: string;
  schemaVersion: string;
  generationModes?: FizzAiGenerationMode[];
  capabilities?: {
    imageToImage?: boolean;
    imageToVideo?: boolean;
    maxOutputs?: number;
    textToImage?: boolean;
    textToVideo?: boolean;
  };
  access?: {
    allowed?: boolean;
    reason?: string;
  };
  input_schema: FizzAiInputSchema;
  parameter_policy?: Record<string, unknown>;
  billing_policy?: {
    productPricing?: AiProductPricingPolicy;
  };
  ui_policy?: {
    defaultMode?: "simple" | "advanced";
    advancedVisible?: boolean;
    showProviderName?: boolean;
    showCostEstimate?: boolean;
    showQueueEstimate?: boolean;
    group?: string;
    recommended?: boolean;
    sortOrder?: number;
  };
}

export interface FizzAiCatalog {
  dialect?: string;
  version?: string;
  region?: string;
  models: FizzAiModel[];
}

export interface FizzAiJobOutput {
  id: string;
  assetId?: string;
  type: FizzAiJobType;
  url: string;
  accessUrl?: string;
  storagePath?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
  bytes?: number;
  createdAt: string;
}

export type FizzAiPromptDocumentNode =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "asset_ref";
      refId: string;
      label?: string;
    }
  | {
      type: "style_ref";
      refId: string;
      label?: string;
    };

export interface FizzAiPromptDocument {
  version: 1;
  nodes: FizzAiPromptDocumentNode[];
}

export interface FizzAiReferenceBinding {
  refId: string;
  kind: FizzAiReferenceKind;
  label: string;
  order: number;
  url?: string;
  assetId?: string;
  role?: string;
  weight?: number;
}

export interface FizzAiStyleBinding {
  refId: string;
  label: string;
  slug?: string;
  type?: string;
  weight?: number;
}

export interface FizzAiJobView {
  id: string;
  request_id?: string;
  type: FizzAiJobType;
  workspaceId?: string | null;
  projectId?: string | null;
  storyProjectId?: string | null;
  documentId?: string | null;
  documentBlockId?: string | null;
  sourceSurface?: string | null;
  provider?: string;
  modelId: string;
  status: string;
  stage: string;
  prompt: string;
  promptDocument?: FizzAiPromptDocument | null;
  promptDisplayText?: string | null;
  promptSearchText?: string | null;
  compiledPrompt?: string | null;
  referenceSnapshot?: FizzAiReferenceBinding[];
  styleSnapshot?: FizzAiStyleBinding[];
  input: Record<string, unknown>;
  outputs: FizzAiJobOutput[];
  error?: {
    code?: string;
    message?: string;
    userMessage?: string;
    retryable?: boolean;
  };
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

export interface FizzAiJobListResponse {
  jobs: FizzAiJobView[];
  nextCursor?: string | null;
}

export interface FizzAiSubmitResponse {
  request_id: string;
  status: string;
  stage: string;
  progress: number | null;
  queue_position: number | null;
  estimated_wait_seconds: number | null;
  estimated_run_seconds: number | null;
  estimated_total_seconds: number | null;
  eta_confidence: "high" | "low" | "medium";
  logs: Array<{ time: string; stage: string; message: string }>;
  response_url: string;
  status_url: string;
  cancel_url: string;
}

export type FizzAiSourceSurface = "fizzstudio-canvas" | "fizzstudio-image-studio" | (string & {});

export interface FizzAiSubmitJobInput {
  context: {
    workspaceId?: string;
    // projectId/documentId are validated for access on submit — only send them
    // once projects are server-backed entities. A local canvas id 404s.
    projectId?: string;
    storyProjectId?: string;
    documentId?: string;
    documentBlockId: string;
    sourceSurface: FizzAiSourceSurface;
  };
  idempotencyKey: string;
  input: Record<string, unknown>;
  promptDocument?: FizzAiPromptDocument;
  referenceBindings?: FizzAiReferenceBinding[];
  styleBindings?: FizzAiStyleBinding[];
  modelId: string;
  schemaVersion: string;
}

/**
 * Terminal-aware status buckets shared by every generation surface. Mirrors the
 * canvas-local helper so feature surfaces don't each re-derive the mapping.
 */
export type FizzAiGenerationStatus =
  | "submitting"
  | "queued"
  | "generating"
  | "done"
  | "failed"
  | "cancelled";

export function generationStatusFromRaw(status: string | null | undefined): FizzAiGenerationStatus {
  if (status === "completed") return "done";
  if (status === "failed" || status === "expired") return "failed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "in_progress" || status === "running") return "generating";
  if (status === "in_queue" || status === "queued") return "queued";
  return "queued";
}

export function isTerminalGenerationStatus(status: FizzAiGenerationStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

/** A generation card's live job state — the canvas-local projection of a job. */
export interface GenerationState {
  jobId?: string;
  status: FizzAiGenerationStatus;
  progress?: number;
  queuePosition?: number;
  etaSeconds?: number;
  outputs?: {
    assetId?: string;
    type: FizzAiJobType;
    url: string;
    accessUrl?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  }[];
  errorCode?: string;
  error?: string;
}

const UNSAFE_GENERATION_ERROR_PATTERNS = [
  /\byour account\s+\d+\b/i,
  /\brequest\s*id\s*:/i,
  /\bmodelnotopen\b/i,
  /\bdreamina-[a-z0-9-]+/i,
  /\bark-[a-z0-9-]+/i,
  /\b\d{10,}\b/,
];

export function isUnsafeGenerationErrorMessage(message?: string): boolean {
  if (!message) return false;
  return UNSAFE_GENERATION_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function safeGenerationErrorMessage(message?: string): string | undefined {
  if (!message?.trim()) return undefined;
  return isUnsafeGenerationErrorMessage(message) ? undefined : message;
}

/** Project an Ai job update / job view / submit response into a card's state. */
export function generationStateFromJob(job: {
  id: string;
  status: string;
  progress?: number | null;
  queuePosition?: number | null;
  estimatedTotalSeconds?: number | null;
  outputs?: Array<{
    assetId?: string;
    type: FizzAiJobType;
    url: string;
    accessUrl?: string;
    width?: number;
    height?: number;
    durationSeconds?: number;
  }>;
  error?: { code?: string; userMessage?: string; message?: string };
}): GenerationState {
  const rawError = job.error?.userMessage || job.error?.message;
  return {
    jobId: job.id,
    status: generationStatusFromRaw(job.status),
    progress: job.progress ?? undefined,
    queuePosition: job.queuePosition ?? undefined,
    etaSeconds: job.estimatedTotalSeconds ?? undefined,
    outputs: job.outputs?.map((output) => ({
      assetId: output.assetId,
      type: output.type,
      url: output.url ?? output.accessUrl,
      accessUrl: output.accessUrl,
      width: output.width,
      height: output.height,
      durationSeconds: output.durationSeconds,
    })),
    errorCode: job.error?.code,
    error: safeGenerationErrorMessage(rawError),
  };
}

export function errorMessageFromJob(job: FizzAiJobView, fallback: string): string {
  return safeGenerationErrorMessage(job.error?.userMessage || job.error?.message) || fallback;
}

export function generationIdempotencyKey(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function compactFizzAiInput(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
  );
}

function schemaProperty(model: FizzAiModel, key: string): FizzAiSchemaProperty | undefined {
  return model.input_schema?.properties?.[key];
}

export function hasSchemaProperty(model: FizzAiModel | undefined, key: string): boolean {
  return Boolean(model?.input_schema?.properties?.[key]);
}

/** Whether the model's schema REQUIRES a prompt (vs merely accepting one). Some
 *  ops expose an optional prompt (e.g. expand/outpainting), so presence alone
 *  must not force the user to type one. */
export function promptRequired(model: FizzAiModel | undefined): boolean {
  return Boolean(model?.input_schema?.required?.includes("prompt"));
}

/** String-enum options for a schema field (e.g. `imageSize`), or `null` if absent. */
export function enumOptions(model: FizzAiModel, key: string): string[] | null {
  const prop = schemaProperty(model, key);
  if (!prop?.enum || prop.enum.length === 0) return null;
  return prop.enum.filter((value): value is string => typeof value === "string");
}

export function enumDefault(model: FizzAiModel, key: string): string | undefined {
  const prop = schemaProperty(model, key);
  return typeof prop?.default === "string" ? prop.default : undefined;
}

export function booleanDefault(model: FizzAiModel, key: string): boolean | undefined {
  const prop = schemaProperty(model, key);
  return typeof prop?.default === "boolean" ? prop.default : undefined;
}

export function integerDefault(model: FizzAiModel, key: string): number | undefined {
  const prop = schemaProperty(model, key);
  return typeof prop?.default === "number" && Number.isFinite(prop.default)
    ? Math.floor(prop.default)
    : undefined;
}

export function numberDefault(model: FizzAiModel, key: string): number | undefined {
  const prop = schemaProperty(model, key);
  return typeof prop?.default === "number" && Number.isFinite(prop.default)
    ? prop.default
    : undefined;
}

export function integerBounds(
  model: FizzAiModel | undefined,
  key: string
): { max?: number; min?: number } {
  const prop = model ? schemaProperty(model, key) : undefined;
  return {
    min:
      typeof prop?.minimum === "number" && Number.isFinite(prop.minimum) ? prop.minimum : undefined,
    max:
      typeof prop?.maximum === "number" && Number.isFinite(prop.maximum) ? prop.maximum : undefined,
  };
}

export function numberBounds(
  model: FizzAiModel | undefined,
  key: string
): { max?: number; min?: number; step?: number } {
  const prop = model ? schemaProperty(model, key) : undefined;
  return {
    min:
      typeof prop?.minimum === "number" && Number.isFinite(prop.minimum) ? prop.minimum : undefined,
    max:
      typeof prop?.maximum === "number" && Number.isFinite(prop.maximum) ? prop.maximum : undefined,
    step:
      typeof prop?.multipleOf === "number" && Number.isFinite(prop.multipleOf)
        ? prop.multipleOf
        : undefined,
  };
}

export function stringMaxLength(model: FizzAiModel | undefined, key: string): number | undefined {
  const prop = model ? schemaProperty(model, key) : undefined;
  return typeof prop?.maxLength === "number" && Number.isFinite(prop.maxLength)
    ? prop.maxLength
    : undefined;
}

/**
 * Max output count for an image model. Reads the `numOutputs.maximum` schema
 * field, falling back to `capabilities.maxOutputs`, then 4. Some models omit
 * the field entirely (no batch support) → callers should clamp to 1.
 */
export function maxOutputs(model: FizzAiModel): number {
  const prop = schemaProperty(model, "numOutputs");
  const schemaMax = prop?.maximum;
  if (typeof schemaMax === "number" && schemaMax > 0) return schemaMax;
  if (typeof model.capabilities?.maxOutputs === "number" && model.capabilities.maxOutputs > 0) {
    return model.capabilities.maxOutputs;
  }
  return 4;
}

export function maxReferenceImages(model: FizzAiModel | undefined): number {
  if (!model) return 0;
  const prop = schemaProperty(model, "referenceImages");
  if (!prop) return 0;
  const schemaMax = prop?.maxItems;
  if (typeof schemaMax === "number" && Number.isFinite(schemaMax) && schemaMax > 0) {
    return Math.floor(schemaMax);
  }
  return 0;
}

export function supportsReferenceImages(model: FizzAiModel | undefined): boolean {
  return maxReferenceImages(model) > 0;
}

/**
 * Parsed upload constraints for one schema reference field (`startFrame`,
 * `endFrame`, `referenceImages`, `referenceVideos`, `referenceAudios`, …).
 * All values come from the catalog's `x-ui` constraint metadata so the
 * upload cards + client validation stay schema-driven. `null` when the
 * selected model doesn't declare the field at all.
 */
export interface FizzAiReferenceFieldConstraints {
  field: string;
  kind: FizzAiReferenceKind;
  /** 1 for single-object fields (start/end frame); `maxItems` for arrays. */
  maxItems: number;
  /** File-picker accept attribute (comma-separated mime types). */
  accept: string;
  acceptFormats: string[];
  maxFileSizeMb?: number;
  maxCombinedFileSizeMb?: number;
  minCombinedDurationSeconds?: number;
  maxCombinedDurationSeconds?: number;
  minItemDurationSeconds?: number;
  maxItemDurationSeconds?: number;
  resolutionBand?: string;
  audioRequiresVisual: boolean;
  /** e.g. "@Image" — uploads are cited in the prompt as `@Image1`, `@Image2`… */
  promptRefPrefix?: string;
  maxTotalFiles?: number;
}

const DEFAULT_REFERENCE_ACCEPT: Record<FizzAiReferenceKind, string> = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/quicktime",
  audio: "audio/mpeg,audio/wav,.mp3,.wav",
};

function referenceKindFromUi(
  ui: NonNullable<FizzAiSchemaProperty["x-ui"]> | undefined
): FizzAiReferenceKind {
  if (ui?.mediaKind === "video" || ui?.mediaKind === "audio" || ui?.mediaKind === "image") {
    return ui.mediaKind;
  }
  if (ui?.control === "video_upload") return "video";
  if (ui?.control === "audio_upload") return "audio";
  return "image";
}

export function referenceFieldConstraints(
  model: FizzAiModel | undefined,
  field: string
): FizzAiReferenceFieldConstraints | null {
  const prop = model ? schemaProperty(model, field) : undefined;
  if (!prop) return null;
  const ui = prop["x-ui"];
  const kind = referenceKindFromUi(ui);
  const maxItems =
    prop.type === "array"
      ? typeof prop.maxItems === "number" && prop.maxItems > 0
        ? Math.floor(prop.maxItems)
        : 0
      : 1;
  if (maxItems <= 0) return null;
  return {
    field,
    kind,
    maxItems,
    accept:
      typeof ui?.accept === "string" && ui.accept ? ui.accept : DEFAULT_REFERENCE_ACCEPT[kind],
    acceptFormats: Array.isArray(ui?.acceptFormats)
      ? ui.acceptFormats.filter((value): value is string => typeof value === "string")
      : [],
    maxFileSizeMb: typeof ui?.maxFileSizeMb === "number" ? ui.maxFileSizeMb : undefined,
    maxCombinedFileSizeMb:
      typeof ui?.maxCombinedFileSizeMb === "number" ? ui.maxCombinedFileSizeMb : undefined,
    minCombinedDurationSeconds:
      typeof ui?.minCombinedDurationSeconds === "number"
        ? ui.minCombinedDurationSeconds
        : undefined,
    maxCombinedDurationSeconds:
      typeof ui?.maxCombinedDurationSeconds === "number"
        ? ui.maxCombinedDurationSeconds
        : undefined,
    minItemDurationSeconds:
      typeof ui?.minItemDurationSeconds === "number" ? ui.minItemDurationSeconds : undefined,
    maxItemDurationSeconds:
      typeof ui?.maxItemDurationSeconds === "number" ? ui.maxItemDurationSeconds : undefined,
    resolutionBand: typeof ui?.resolutionBand === "string" ? ui.resolutionBand : undefined,
    audioRequiresVisual: ui?.audioRequiresVisual === true,
    promptRefPrefix: typeof ui?.promptRefPrefix === "string" ? ui.promptRefPrefix : undefined,
    maxTotalFiles: typeof ui?.maxTotalFiles === "number" ? ui.maxTotalFiles : undefined,
  };
}

export function supportsOutputCount(model: FizzAiModel): boolean {
  return Boolean(schemaProperty(model, "numOutputs"));
}

/**
 * Every reference/upload field a model declares (start/end frame, reference
 * images, reference videos, reference audios, …), schema-driven and in UI
 * order. Image models surface only image fields; video models like Seedance
 * surface image + video + audio fields. The mask field surfaces only in
 * inpainting mode (as a plain upload card for now; a mask-draw UX is a later
 * refinement).
 */
export function referenceFields(model: FizzAiModel | undefined): FizzAiReferenceFieldConstraints[] {
  const props = model?.input_schema?.properties;
  if (!props) return [];
  const collected: { constraints: FizzAiReferenceFieldConstraints; order: number }[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const ui = prop["x-ui"];
    const isUpload =
      ui?.control === "image_upload" ||
      ui?.control === "video_upload" ||
      ui?.control === "audio_upload" ||
      ui?.group === "references";
    if (!isUpload) continue;
    const constraints = referenceFieldConstraints(model, name);
    if (constraints) {
      collected.push({ constraints, order: typeof ui?.order === "number" ? ui.order : 999 });
    }
  }
  return collected
    .sort((a, b) => a.order - b.order || a.constraints.field.localeCompare(b.constraints.field))
    .map((entry) => entry.constraints);
}

const MODE_LABELS: Record<string, string> = {
  text_to_image: "Text to Image",
  text_to_video: "Text to Video",
  image_to_image: "Image to Image",
  image_to_panorama: "Panorama",
  image_to_video: "Image to Video",
  video_to_video: "Video to Video",
  first_last_frame_to_video: "First & Last Frame",
  multimodal_to_video: "Omni Reference",
  inpainting: "Inpaint",
  outpainting: "Expand",
  upscale: "Upscale",
  remove_background: "Remove BG",
  relight: "Relight",
  multi_angle: "Multi-Angle",
};

/** Human label for a generation mode id (e.g. `multimodal_to_video`). */
export function modeLabel(mode: string): string {
  return (
    MODE_LABELS[mode] ??
    mode
      .replace(/_/g, " ")
      .replace(/\bto\b/g, "→")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** The mode a card should start in — simplest (text-to-*) if offered. */
export function defaultMode(model: FizzAiModel | undefined): string | undefined {
  const modes = model?.generationModes ?? [];
  return modes.find((m) => m.startsWith("text_to_")) ?? modes[0];
}

const CANVAS_DEFAULT_MODE_PRIORITY: Record<FizzAiJobType, readonly FizzAiGenerationMode[]> = {
  image: ["image_to_image"],
  video: ["multimodal_to_video", "image_to_video", "first_last_frame_to_video", "video_to_video"],
};

/**
 * Product defaults for newly-created blank cards. Canonical model ids are
 * stable catalog identities; an unavailable or inaccessible preferred model
 * falls through to the capability-based policy below.
 */
const CANVAS_PREFERRED_MODEL_ID: Partial<Record<FizzAiJobType, string>> = {
  video: "seedance-2-5",
};

/** New blank canvas cards should start in reference-friendly modes. */
export function canvasDefaultMode(model: FizzAiModel | undefined): string | undefined {
  const modes = model?.generationModes ?? [];
  const priority = model ? CANVAS_DEFAULT_MODE_PRIORITY[model.type] : [];
  return priority.find((mode) => modes.includes(mode)) ?? defaultMode(model);
}

/** Modes reached via a dedicated canvas action (a toolbar button on an image),
 *  never the general model picker. */
const OPERATION_ONLY_MODES: readonly string[] = [
  "image_to_panorama",
  "upscale",
  "remove_background",
  "relight",
  "multi_angle",
  "outpainting",
];

/** A model backing only canvas operations (Upscale / Remove BG / 720° / Motion)
 *  — reached from an image toolbar action, not the general model picker. True
 *  when every mode it offers is operation-only, or it exposes a bespoke-editor
 *  param (e.g. the Kling motion brush's `dynamicMasks`). */
export function isOperationOnlyModel(model: FizzAiModel): boolean {
  if (model.input_schema?.properties?.dynamicMasks) return true;
  const modes = model.generationModes ?? [];
  return modes.length > 0 && modes.every((m) => OPERATION_ONLY_MODES.includes(m));
}

/**
 * The reference inputs that belong to ONE generation mode. Modes are mutually
 * exclusive (text-to / image-to / first-last-frame / omni-reference), so only
 * the active mode's uploads are shown. The catalog ships mode ids but no
 * explicit mode→field map, so we resolve it by the stable `X_to_Y` naming
 * convention, falling back to "show what fits" for unknown modes.
 */
export function referenceFieldsForMode(
  model: FizzAiModel | undefined,
  mode: string | undefined
): FizzAiReferenceFieldConstraints[] {
  const all = referenceFields(model);
  if (all.length === 0 || !mode || mode.startsWith("text_to_")) return [];
  const pick = (...names: string[]) =>
    names
      .map((n) => all.find((f) => f.field === n))
      .filter((f): f is FizzAiReferenceFieldConstraints => Boolean(f));
  const frames = all.filter((f) => /frame/i.test(f.field));
  const nonFrames = all.filter((f) => !/frame/i.test(f.field));

  if (mode === "first_last_frame_to_video") {
    const explicit = pick("startFrame", "firstFrame", "endFrame", "lastFrame");
    return explicit.length ? explicit : frames;
  }
  if (mode === "multimodal_to_video") {
    const explicit = pick("referenceImages", "referenceVideos", "referenceAudios");
    return explicit.length ? explicit : nonFrames;
  }
  if (mode === "image_to_video" || mode === "image_to_panorama") {
    const explicit = pick("startFrame", "referenceImages");
    return explicit.length ? [explicit[0]] : all.filter((f) => f.kind === "image").slice(0, 1);
  }
  if (mode === "image_to_image" || mode === "video_to_video") {
    const explicit = pick("referenceImages", "referenceVideos");
    return explicit.length ? explicit : nonFrames.filter((f) => !/audio/i.test(f.field));
  }
  if (mode === "inpainting") return pick("referenceImages", "maskImage");
  // Single-image operations (upscale / remove background / relight /
  // multi-angle / expand) bind exactly one input image.
  if (
    mode === "upscale" ||
    mode === "remove_background" ||
    mode === "relight" ||
    mode === "multi_angle" ||
    mode === "outpainting"
  ) {
    const explicit = pick("referenceImages");
    return explicit.length ? explicit : all.filter((f) => f.kind === "image").slice(0, 1);
  }
  return all;
}

/**
 * Positional frame roles, as opposed to prompt-addressable references. Kept
 * separate from {@link SINGLE_REFERENCE_FIELDS} even though the two currently
 * hold the same names: that one is about CARDINALITY (one value, not an array),
 * this one about MEANING. A future single-valued non-frame field (`maskImage`)
 * must stay bindable, and a future array-valued frame field must not.
 */
const FRAME_REFERENCE_FIELDS = new Set(["startFrame", "firstFrame", "endFrame", "lastFrame"]);

/** Reference fields carrying ONE value rather than an array. */
const SINGLE_REFERENCE_FIELDS = new Set(["startFrame", "firstFrame", "endFrame", "lastFrame"]);

/** Minimal reference row for submit helpers (canvas CardReference). */
export type ReferenceRowLike = {
  id: string;
  url: string;
  assetId?: string;
  /** Exact media duration when known (video/audio). Required by catalog duration rules. */
  durationSeconds?: number | null;
  bytes?: number | null;
  kind?: FizzAiReferenceKind;
  uploading?: boolean;
};

function referenceEntry(row: ReferenceRowLike): string | Record<string, string | number> {
  const duration =
    typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds)
      ? row.durationSeconds
      : undefined;
  const bytes = typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : undefined;
  // Prefer object form whenever we have metadata the server kernel needs.
  if (row.assetId || duration != null || bytes != null) {
    return {
      url: row.url,
      ...(row.assetId ? { assetId: row.assetId, refId: row.id } : {}),
      ...(duration != null ? { durationSeconds: duration } : {}),
      ...(bytes != null ? { bytes } : {}),
    };
  }
  return row.url;
}

/**
 * Catalog-driven preflight (same pure kernel as the server). Call before submit;
 * surface blocking issues with Alert — never add model-specific ifs here.
 */
export function validateModelGenerationInput(
  model: FizzAiModel,
  input: Record<string, unknown>,
  media?: readonly MediaRefSnapshot[]
): ValidationIssue[] {
  return validateGenerationInput({
    inputSchema: model.input_schema ?? {},
    input,
    media,
  });
}

export function generationInputHasBlockingIssues(issues: readonly ValidationIssue[]): boolean {
  return hasBlockingValidationIssues(issues);
}

export function firstGenerationValidationMessage(
  issues: readonly ValidationIssue[]
): string | undefined {
  return firstBlockingValidationMessage(issues);
}

/** Build MediaRefSnapshot[] from canvas reference rows for the active mode. */
export function mediaSnapshotsForMode(
  model: FizzAiModel,
  mode: string | undefined,
  references: Record<string, ReferenceRowLike[] | undefined> | undefined
): MediaRefSnapshot[] {
  const snapshots: MediaRefSnapshot[] = [];
  for (const field of referenceFieldsForMode(model, mode)) {
    for (const row of references?.[field.field] ?? []) {
      if (!/^https?:/i.test(row.url) && !row.url.startsWith("blob:")) continue;
      if (row.uploading) continue;
      snapshots.push({
        field: field.field,
        kind: row.kind ?? field.kind,
        url: row.url,
        assetId: row.assetId,
        durationSeconds:
          typeof row.durationSeconds === "number" && Number.isFinite(row.durationSeconds)
            ? row.durationSeconds
            : null,
        bytes: typeof row.bytes === "number" && Number.isFinite(row.bytes) ? row.bytes : null,
      });
    }
  }
  return snapshots;
}

export type PromptReferenceRowLike = ReferenceRowLike & {
  kind?: FizzAiReferenceKind;
  name?: string;
  uploading?: boolean;
};

const PROMPT_MENTION_LABEL_PREFIX: Record<FizzAiReferenceKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

function promptMentionLabel(kind: FizzAiReferenceKind, indexWithinKind: number): string {
  return `${PROMPT_MENTION_LABEL_PREFIX[kind]}${indexWithinKind}`;
}

/**
 * Build schema-shaped reference input for ONLY the active generation mode's
 * fields. Stale slots from a previous mode (e.g. `referenceImages` after
 * switching to i2v) are omitted so Seedance's frame↔reference rule isn't hit.
 */
export function buildReferenceInputForMode(
  model: FizzAiModel,
  mode: string | undefined,
  references: Record<string, ReferenceRowLike[] | undefined> | undefined
): Record<string, unknown> {
  const properties = model.input_schema?.properties ?? {};
  const referenceInput: Record<string, unknown> = {};
  for (const { field } of referenceFieldsForMode(model, mode)) {
    const ready = (references?.[field] ?? []).filter((row) => /^https?:/i.test(row.url));
    if (ready.length === 0) continue;
    if (SINGLE_REFERENCE_FIELDS.has(field)) {
      referenceInput[field] = referenceEntry(ready[0]);
      continue;
    }
    if (properties[field]?.type === "array") {
      referenceInput[field] = ready.map(referenceEntry);
      continue;
    }
    referenceInput[field] = referenceEntry(ready[0]);
  }
  return referenceInput;
}

/**
 * Build the structured bindings whose labels match composer `@Image1` /
 * `@Video1` tokens. Only the active mode's ready references are bindable, using
 * the same field order as the visible reference stack.
 *
 * Start/end frames are deliberately NOT bindable. `[Image1]`-style tokens are a
 * multimodal-reference feature (ModelArk doc 2298881 demos them only there); a
 * frame is a positional role, not something the prompt addresses. Binding one
 * also broke generation: the server materializes bindings back into
 * `input.referenceImages`, which put the same asset under both `startFrame` and
 * `referenceImages` and tripped the provider's frame↔reference exclusivity rule
 * (`InvalidParameter: first/last frame content cannot be mixed with reference
 * media content`) — every image-to-video and first/last-frame job from the
 * canvas failed this way.
 */
export function buildPromptReferenceBindingsForMode(
  model: FizzAiModel,
  mode: string | undefined,
  references: Record<string, PromptReferenceRowLike[] | undefined> | undefined
): FizzAiReferenceBinding[] {
  const counts: Record<FizzAiReferenceKind, number> = { image: 0, video: 0, audio: 0 };
  const bindings: FizzAiReferenceBinding[] = [];
  for (const field of referenceFieldsForMode(model, mode)) {
    if (FRAME_REFERENCE_FIELDS.has(field.field)) continue;
    const ready = (references?.[field.field] ?? []).filter(
      (row) => !row.uploading && /^https?:/i.test(row.url)
    );
    for (const row of ready) {
      const kind = row.kind ?? field.kind;
      counts[kind] += 1;
      bindings.push({
        refId: row.id,
        kind,
        label: promptMentionLabel(kind, counts[kind]),
        order: bindings.length,
        url: row.url,
        assetId: row.assetId,
      });
    }
  }
  return bindings;
}

// ── Schema-driven UI (x-ui hints) ───────────────────────────────────────────
// The catalog stamps each schema property with an `x-ui` hint (control type,
// group, order). One generic settings panel renders any model — image, video,
// audio — straight from these, so adding a model/param needs no UI change.

export type SchemaControl =
  | "select"
  | "segmented"
  | "stepper"
  | "slider"
  | "switch"
  | "radio"
  | "textarea"
  | "image_upload"
  | (string & {});

/** One selectable option: value is settings/wire; label is UI-only. */
export interface SchemaFieldOption {
  value: string | number | boolean;
  /** Plain display string when no i18n key. */
  label?: string;
  /** i18n key under canvasControls (e.g. sizePresets.auto). */
  labelKey?: string;
}

export interface SchemaFieldDescriptor {
  name: string;
  control: SchemaControl;
  group: string;
  order: number;
  type: string;
  enum: (string | number)[] | null;
  /** Prefer over bare enum for labels (protocol x-ui.options). */
  options: SchemaFieldOption[] | null;
  default: string | number | boolean | undefined;
  min?: number;
  max?: number;
  unit?: string;
  title?: string;
}

/** A flat field→value bag — exactly the shape the submit input expects. */
// Most controls are scalars; a few ops carry structured values the request
// mapper passes through as-is — numeric tuples (expand's canvas_size) and object
// arrays (the motion brush's dynamic_masks). The generic settings panel coerces
// non-scalars away, so they only ride along for bespoke editors.
export type ModelSettings = Record<string, string | number | boolean | unknown[]>;

function inferControl(prop: FizzAiSchemaProperty): SchemaControl {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return "segmented";
  if (prop.type === "boolean") return "switch";
  if (prop.type === "integer" || prop.type === "number") return "slider";
  return "segmented";
}

/**
 * Ordered, renderable schema fields for a model. Prompt + upload fields are
 * skipped — the composer owns those. Sorted by the schema's `x-ui.order`.
 */
export function schemaFields(model: FizzAiModel | undefined): SchemaFieldDescriptor[] {
  const props = model?.input_schema?.properties;
  if (!props) return [];
  const fields: SchemaFieldDescriptor[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const ui = prop["x-ui"] ?? {};
    const control = ui.control ?? inferControl(prop);
    const group = ui.group ?? "settings";
    // The main prompt (composer-owned) + reference/upload fields are NOT panel
    // settings. Other text fields (e.g. negativePrompt) ARE rendered here.
    if (name === "prompt" || control === "image_upload" || group === "references") continue;
    const enumValues = Array.isArray(prop.enum)
      ? prop.enum.filter(
          (value): value is string | number =>
            typeof value === "string" || typeof value === "number"
        )
      : null;
    const rawOptions = Array.isArray(ui.options) ? ui.options : null;
    const options: SchemaFieldOption[] | null = rawOptions
      ? rawOptions
          .filter(
            (opt) =>
              opt &&
              (typeof opt.value === "string" ||
                typeof opt.value === "number" ||
                typeof opt.value === "boolean")
          )
          .map((opt) => ({
            value: opt.value,
            label: typeof opt.label === "string" ? opt.label : undefined,
            labelKey: typeof opt.labelKey === "string" ? opt.labelKey : undefined,
          }))
      : null;

    fields.push({
      name,
      control,
      group,
      order: typeof ui.order === "number" ? ui.order : 999,
      type: prop.type ?? "string",
      // Prefer option values as the enum source when catalog shipped options.
      enum:
        options && options.length > 0
          ? options
              .map((opt) => opt.value)
              .filter(
                (value): value is string | number =>
                  typeof value === "string" || typeof value === "number"
              )
          : enumValues,
      options,
      default: prop.default as string | number | boolean | undefined,
      min: typeof prop.minimum === "number" ? prop.minimum : undefined,
      max: typeof prop.maximum === "number" ? prop.maximum : undefined,
      unit: typeof ui.unit === "string" ? ui.unit : undefined,
      title: prop.title,
    });
  }
  return fields.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * Seed a settings bag from a model's schema defaults. Numerics WITHOUT a
 * schema default stay unset on purpose (e.g. `seed` → empty input with a
 * "Random" placeholder, so the provider randomizes instead of receiving the
 * schema minimum).
 */
export function defaultSettingsForModel(model: FizzAiModel | undefined): ModelSettings {
  const out: ModelSettings = {};
  for (const field of schemaFields(model)) {
    if (field.default !== undefined) out[field.name] = field.default;
    else if (field.enum && field.enum.length > 0) out[field.name] = field.enum[0];
    else if (field.type === "boolean") out[field.name] = false;
  }
  return out;
}

/**
 * Re-base a card's settings onto a newly-selected model: start from the new
 * model's defaults, then KEEP each prior scalar value only if it's still valid
 * for the new model (same field, and in its enum when it has one). Prevents a
 * stale value from a previous model (e.g. Seedance's `resolution: "720p"` vs
 * Wan's `"720P"`, or `aspect: "auto"`) from carrying over and making the request
 * unroutable for the new model.
 */
/**
 * Map Seedance-style `auto` ↔ MiniMax-style `adaptive` when the new model only
 * accepts the other token. Wire values stay provider-native; UI labels both as Auto.
 */
function coerceAspectRatioEnumValue(value: string, enumValues: string[]): string | undefined {
  if (enumValues.includes(value)) return value;
  const lower = value.toLowerCase();
  if (lower === "auto" && enumValues.includes("adaptive")) return "adaptive";
  if (lower === "adaptive" && enumValues.includes("auto")) return "auto";
  return undefined;
}

export function mergeCompatibleSettings(
  model: FizzAiModel | undefined,
  prev: ModelSettings
): ModelSettings {
  const next = defaultSettingsForModel(model);
  for (const field of schemaFields(model)) {
    const value = prev[field.name];
    if (value === undefined || Array.isArray(value)) continue;
    if (field.enum && field.enum.length > 0) {
      const enumStrings = field.enum.map(String);
      const raw = String(value);
      if (enumStrings.includes(raw)) {
        next[field.name] = value;
        continue;
      }
      // Aspect-ratio fields: auto ↔ adaptive across providers.
      if (
        field.name === "aspectRatio" ||
        field.name === "aspect_ratio" ||
        field.name === "imageSize" ||
        field.name === "size"
      ) {
        const coerced = coerceAspectRatioEnumValue(raw, enumStrings);
        if (coerced !== undefined) next[field.name] = coerced;
      }
    } else {
      next[field.name] = value;
    }
  }
  return next;
}

export function isFizzAiModelUsable(model: FizzAiModel): boolean {
  return model.enabled && model.access?.allowed !== false;
}

export function canvasDefaultModel(
  catalog: FizzAiCatalog | undefined,
  modality: FizzAiJobType
): FizzAiModel | undefined {
  const models = (catalog?.models ?? []).filter(
    (model) => model.type === modality && isFizzAiModelUsable(model)
  );
  const preferredModelId = CANVAS_PREFERRED_MODEL_ID[modality];
  const preferred = preferredModelId
    ? models.find((model) => model.id === preferredModelId)
    : undefined;
  if (preferred) return preferred;

  const priority = CANVAS_DEFAULT_MODE_PRIORITY[modality];
  return (
    models.find((model) => priority.some((mode) => model.generationModes?.includes(mode))) ??
    models[0]
  );
}

export function filterFizzAiInput(
  model: FizzAiModel,
  values: Record<string, unknown>
): Record<string, unknown> {
  const properties = model.input_schema?.properties;
  if (!properties || model.input_schema.additionalProperties === true) return values;

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const prop = properties[key];
    if (!prop) continue; // not a parameter this model accepts
    // Drop a value that violates the model's enum (e.g. a `resolution` left over
    // from a previously-selected model) — sending it makes the request
    // unroutable; omitting it lets the provider fall back to its default.
    if (
      Array.isArray(prop.enum) &&
      (typeof value === "string" || typeof value === "number") &&
      !prop.enum.map((v) => String(v)).includes(String(value))
    ) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function normalizeFizzAiError(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    if ("responseBody" in error && typeof error.responseBody === "string") {
      try {
        const parsed = JSON.parse(error.responseBody) as Record<string, unknown>;
        const msg = parsed.msg ?? parsed.message;
        if (typeof msg === "string" && msg.trim()) {
          return safeGenerationErrorMessage(msg) || fallback;
        }
      } catch {
        // fall through
      }
    }
    if ("message" in error && typeof error.message === "string" && error.message.trim()) {
      return safeGenerationErrorMessage(error.message) || fallback;
    }
  }
  return fallback;
}

export async function listFizzAiCatalog(): Promise<FizzAiCatalog> {
  const response = await api.get<FizzAiCatalog>("/aurora/ai/models", {
    timeout: 15_000,
  });
  const models = Array.isArray(response.models) ? response.models : [];
  // Catalog boundary should already attach options; client re-applies so older
  // caches / non-canonical catalog paths still get label/value-first enums.
  return {
    ...response,
    models: models.map((model) => {
      if (!model.input_schema) return model;
      return withAttachedUiOptions({
        ...model,
        input_schema: model.input_schema as AiObjectSchema,
      }) as FizzAiModel;
    }),
  };
}

export interface FizzAiPointEstimateInput {
  /** Video duration as submitted (string enum incl. "auto", or seconds). */
  duration?: string | number;
  /** Legacy numeric duration field (integer-slider video models). */
  durationSeconds?: number;
  hasMask?: boolean;
  numOutputs?: number;
  quality?: string;
  referenceImageCount?: number;
  /** Combined duration of all attached reference videos. */
  referenceVideoSeconds?: number;
  resolution?: string;
}

/** Live product-price estimate for a model and selected ContainerModel params. */
export function estimateModelSellPoints(
  model: FizzAiModel | undefined,
  input: FizzAiPointEstimateInput = {}
): { sellPoints: number; pricingVersion: string; pointsPerOutput: number } | null {
  const productPricing = model?.billing_policy?.productPricing;
  if (!productPricing) return null;
  try {
    const result = estimateProductModelPoints({
      policy: productPricing,
      numOutputs: input.numOutputs,
      quality: input.quality,
      duration: input.duration,
      durationSeconds: input.durationSeconds,
      referenceImageCount: input.referenceImageCount,
      referenceVideoSeconds: input.referenceVideoSeconds,
      resolution: input.resolution,
      hasMask: input.hasMask,
    });
    return {
      sellPoints: result.sellPoints,
      pricingVersion: result.pricingVersion,
      pointsPerOutput: result.pointsPerOutput,
    };
  } catch {
    return null;
  }
}

/**
 * Cheapest sell-points across a model's pricing tiers (the catalog default is
 * the *most expensive* combo for some models, e.g. seedance 720p/10s). The
 * model row should advertise the floor ("from X"), not the max.
 */
export function cheapestSellPoints(model: FizzAiModel | undefined): number | null {
  const pricing = model?.billing_policy?.productPricing;
  if (!pricing) return null;
  const numOutputs = (pricing as { minOutputCount?: number }).minOutputCount ?? 1;
  if (pricing.mode === "parameter_matrix") {
    const resolutions = pricing.resolutionOptions?.length ? pricing.resolutionOptions : [undefined];
    const qualities = pricing.qualityOptions?.length ? pricing.qualityOptions : [undefined];
    let min: number | null = null;
    for (const resolution of resolutions) {
      for (const quality of qualities) {
        const est = estimateModelSellPoints(model, { resolution, quality, numOutputs });
        if (est && (min === null || est.sellPoints < min)) min = est.sellPoints;
      }
    }
    if (min !== null) return min;
  }
  if (pricing.mode === "per_second_matrix") {
    // Floor = cheapest resolution at the minimum billable duration.
    let min: number | null = null;
    for (const resolution of Object.keys(pricing.pointsPerSecond)) {
      const est = estimateModelSellPoints(model, {
        resolution,
        duration: pricing.minSeconds,
        numOutputs,
      });
      if (est && (min === null || est.sellPoints < min)) min = est.sellPoints;
    }
    if (min !== null) return min;
  }
  return estimateModelSellPoints(model, { numOutputs })?.sellPoints ?? null;
}

/** Surface a 429 quota rejection as the shared upgrade dialog, then rethrow. */
function emitUpgradeOn429(): void {
  // Upgrade dialog is fizzstudio-only; no-op in studio.
}

export async function submitFizzAiJob(input: FizzAiSubmitJobInput): Promise<FizzAiSubmitResponse> {
  try {
    return await api.post<FizzAiSubmitResponse>("/aurora/ai/jobs", {
      timeout: 30_000,
      data: {
        context: input.context,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
        promptDocument: input.promptDocument,
        referenceBindings: input.referenceBindings,
        styleBindings: input.styleBindings,
        modelId: input.modelId,
        schemaVersion: input.schemaVersion,
      },
    });
  } catch (err) {
    emitUpgradeOn429();
    throw err;
  }
}

/**
 * Server-side retry of an existing job (`POST /aurora/ai/jobs/:id/retry`).
 * The server resubmits the job's own normalized input / prompt document /
 * bindings, so the client never has to reconstruct the original contract.
 */
export async function retryFizzAiJob(id: string): Promise<FizzAiSubmitResponse> {
  try {
    return await api.post<FizzAiSubmitResponse>(`/aurora/ai/jobs/${encodeURIComponent(id)}/retry`, {
      timeout: 30_000,
    });
  } catch (err) {
    emitUpgradeOn429();
    throw err;
  }
}

/* ── prompt document builders (shared by the image + video studios) ───────── */

/** Minimal mention source `buildPromptDocument` needs to bind `@Label` tokens. */
export interface FizzAiPromptMentionSource {
  refId: string;
  label: string;
}

/**
 * Build the structured prompt document from the raw prompt text plus the
 * reference bindings whose `@Label` tokens appear in it. Falls back to a
 * single text node when nothing is mentioned.
 */
export function buildPromptDocument(
  prompt: string,
  references: readonly FizzAiPromptMentionSource[]
): FizzAiPromptDocument {
  const nodes = promptDocumentNodesFromMentions(prompt, references);
  return {
    version: 1,
    nodes: nodes.length > 0 ? nodes : [{ type: "text", text: prompt }],
  };
}

function promptDocumentNodesFromMentions(
  prompt: string,
  references: readonly FizzAiPromptMentionSource[]
): FizzAiPromptDocument["nodes"] {
  if (!prompt || references.length === 0) return [];

  const matches: Array<{ binding: FizzAiPromptMentionSource; end: number; start: number }> = [];
  for (const binding of references) {
    const token = `@${binding.label}`;
    let cursor = 0;
    while (cursor < prompt.length) {
      const start = prompt.indexOf(token, cursor);
      if (start < 0) break;
      const end = start + token.length;
      if (isPromptMentionTokenEnd(prompt, end)) {
        matches.push({ binding, start, end });
      }
      cursor = end;
    }
  }

  if (matches.length === 0) return [];
  matches.sort((a, b) =>
    a.start === b.start ? b.end - b.start - (a.end - a.start) : a.start - b.start
  );

  const nodes: FizzAiPromptDocument["nodes"] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) {
      nodes.push({ type: "text", text: prompt.slice(cursor, match.start) });
    }
    nodes.push({
      type: "asset_ref",
      refId: match.binding.refId,
      label: match.binding.label,
    });
    cursor = match.end;
  }
  if (cursor < prompt.length) nodes.push({ type: "text", text: prompt.slice(cursor) });
  return nodes;
}

function isPromptMentionTokenEnd(prompt: string, end: number): boolean {
  if (end >= prompt.length) return true;
  // Mention labels are ASCII (`Image1`, `Video2`, ...). Treat any non-ASCII
  // continuation (notably CJK text) as a boundary so users don't need to type a
  // space after a mention, while still preventing `@Image1` from matching
  // `@Image10` or `@Image1foo`.
  return !/^[A-Za-z0-9_]/.test(prompt[end] ?? "");
}

export async function getFizzAiJob(id: string): Promise<FizzAiJobView> {
  return api.get<FizzAiJobView>(`/aurora/ai/jobs/${encodeURIComponent(id)}`, {
    timeout: 15_000,
  });
}

export async function listFizzAiJobs(input: {
  limit?: number;
  sourceSurface?: string;
  type?: FizzAiJobType;
}): Promise<FizzAiJobListResponse> {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.sourceSurface) params.set("sourceSurface", input.sourceSurface);
  if (input.type) params.set("type", input.type);
  const query = params.toString();
  return api.get<FizzAiJobListResponse>(`/aurora/ai/jobs${query ? `?${query}` : ""}`, {
    timeout: 15_000,
  });
}

export async function cancelFizzAiJob(id: string): Promise<FizzAiJobView> {
  return api.post<FizzAiJobView>(`/aurora/ai/jobs/${encodeURIComponent(id)}/cancel`, {
    timeout: 15_000,
  });
}
