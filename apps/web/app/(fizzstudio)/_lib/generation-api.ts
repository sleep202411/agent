"use client";

import { estimateProductModelPoints, type AiProductPricingPolicy } from "@repo/shared";
import { api } from "@/src/lib/api";
import { ApiRequestError } from "@/src/lib/api/api-client";
import { emitUpgrade, payloadFromServerError } from "@/src/lib/quota/upgrade-dialog-store";

export type FizzAiJobType = "image" | "video";
export type FizzAiGenerationMode =
  | "first_last_frame_to_video"
  | "image_to_image"
  | "image_to_video"
  | "multimodal_to_video"
  | "text_to_image"
  | "text_to_video"
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
    /** Upload constraint metadata (reference upload fields). */
    accept?: string;
    mediaKind?: FizzAiReferenceKind;
    acceptFormats?: string[];
    maxFileSizeMb?: number;
    maxCombinedFileSizeMb?: number;
    minCombinedDurationSeconds?: number;
    maxCombinedDurationSeconds?: number;
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
}

export interface FizzAiCatalog {
  dialect?: string;
  version?: string;
  region?: string;
  models: FizzAiModel[];
}

export interface FizzAiJobOutput {
  id: string;
  type: FizzAiJobType;
  url: string;
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
  idempotencyKey?: string;
  type: FizzAiJobType;
  workspaceId?: string | null;
  projectId?: string | null;
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
    projectId: string;
    documentId: string;
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
export type FizzAiGenerationStatus = "queued" | "generating" | "done" | "failed" | "cancelled";

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

export function errorMessageFromJob(job: FizzAiJobView, fallback: string): string {
  return job.error?.userMessage || job.error?.message || fallback;
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
  resolutionBand?: string;
  audioRequiresVisual: boolean;
  /** e.g. "@Image" — uploads are cited in the prompt as `@Image1`, `@Image2`… */
  promptRefPrefix?: string;
  maxTotalFiles?: number;
}

const DEFAULT_REFERENCE_ACCEPT: Record<FizzAiReferenceKind, string> = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/quicktime",
  audio: "audio/mpeg,audio/wav",
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
    resolutionBand: typeof ui?.resolutionBand === "string" ? ui.resolutionBand : undefined,
    audioRequiresVisual: ui?.audioRequiresVisual === true,
    promptRefPrefix: typeof ui?.promptRefPrefix === "string" ? ui.promptRefPrefix : undefined,
    maxTotalFiles: typeof ui?.maxTotalFiles === "number" ? ui.maxTotalFiles : undefined,
  };
}

export function supportsOutputCount(model: FizzAiModel): boolean {
  return Boolean(schemaProperty(model, "numOutputs"));
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

export interface SchemaFieldDescriptor {
  name: string;
  control: SchemaControl;
  group: string;
  order: number;
  type: string;
  enum: string[] | null;
  default: string | number | boolean | undefined;
  min?: number;
  max?: number;
  unit?: string;
  title?: string;
}

/** A flat field→value bag — exactly the shape the submit input expects. */
export type ModelSettings = Record<string, string | number | boolean>;

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
    fields.push({
      name,
      control,
      group,
      order: typeof ui.order === "number" ? ui.order : 999,
      type: prop.type ?? "string",
      enum: Array.isArray(prop.enum)
        ? prop.enum.filter((value): value is string => typeof value === "string")
        : null,
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

export function isFizzAiModelUsable(model: FizzAiModel): boolean {
  return model.enabled && model.access?.allowed !== false;
}

export function pickFizzAiModel(
  catalog: FizzAiCatalog,
  type: FizzAiJobType,
  preferredModes: FizzAiGenerationMode[]
): FizzAiModel | null {
  const candidates = catalog.models.filter(
    (model) => model.type === type && isFizzAiModelUsable(model)
  );
  if (candidates.length === 0) return null;

  for (const mode of preferredModes) {
    const byMode = candidates.find((model) => model.generationModes?.includes(mode));
    if (byMode) return byMode;

    const byCapability = candidates.find((model) => {
      if (mode === "text_to_image") return model.capabilities?.textToImage;
      if (mode === "image_to_image") return model.capabilities?.imageToImage;
      if (mode === "text_to_video") return model.capabilities?.textToVideo;
      if (mode === "image_to_video" || mode === "first_last_frame_to_video") {
        return model.capabilities?.imageToVideo;
      }
      return false;
    });
    if (byCapability) return byCapability;
  }

  return candidates[0] ?? null;
}

export function filterFizzAiInput(
  model: FizzAiModel,
  values: Record<string, unknown>
): Record<string, unknown> {
  const properties = model.input_schema?.properties;
  if (!properties || model.input_schema.additionalProperties === true) return values;

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key in properties) next[key] = value;
  }
  return next;
}

export function normalizeFizzAiError(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    if ("responseBody" in error && typeof error.responseBody === "string") {
      try {
        const parsed = JSON.parse(error.responseBody) as Record<string, unknown>;
        const msg = parsed.msg ?? parsed.message;
        if (typeof msg === "string" && msg.trim()) return msg;
      } catch {
        // fall through
      }
    }
    if ("message" in error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

export async function listFizzAiCatalog(): Promise<FizzAiCatalog> {
  const response = await api.get<FizzAiCatalog>("/aurora/ai/models", {
    timeout: 15_000,
  });
  return {
    ...response,
    models: Array.isArray(response.models) ? response.models : [],
  };
}

export interface FizzAiPointEstimateInput {
  referenceMedia?: {
    images?: readonly unknown[];
    videos?: readonly unknown[];
    audios?: readonly unknown[];
  };
  text?: string;
  generateAudio?: boolean;
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
  /**
   * Provider contract where an 'auto' duration follows the reference videos'
   * combined length (Seedance 2.5 edit). Must mirror the server-side quote
   * flag so the displayed estimate always matches the wallet hold.
   */
  outputDurationFollowsReferenceVideos?: boolean;
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
      text: input.text,
      numOutputs: input.numOutputs,
      quality: input.quality,
      duration: input.duration,
      durationSeconds: input.durationSeconds,
      generateAudio: input.generateAudio,
      referenceImageCount: input.referenceImageCount,
      referenceMedia: input.referenceMedia,
      referenceVideoSeconds: input.referenceVideoSeconds,
      outputDurationFollowsReferenceVideos: input.outputDurationFollowsReferenceVideos,
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
      for (const generateAudio of pricing.videoOnlyPointsPerSecond ? [true, false] : [undefined]) {
        const est = estimateModelSellPoints(model, {
          resolution,
          duration: pricing.minSeconds,
          generateAudio,
          numOutputs,
        });
        if (est && (min === null || est.sellPoints < min)) min = est.sellPoints;
      }
    }
    if (min !== null) return min;
  }
  if (pricing.mode === "per_character") {
    return (
      estimateModelSellPoints(model, {
        text: "x".repeat(pricing.minCharacters),
        numOutputs,
      })?.sellPoints ?? null
    );
  }
  return estimateModelSellPoints(model, { numOutputs })?.sellPoints ?? null;
}

/** Surface a 429 quota rejection as the shared upgrade dialog, then rethrow. */
function emitUpgradeOn429(err: unknown): void {
  if (err instanceof ApiRequestError && err.status === 429 && err.responseBody) {
    try {
      const parsed = JSON.parse(err.responseBody) as Record<string, unknown>;
      const payload = payloadFromServerError(parsed);
      if (payload) emitUpgrade(payload);
    } catch {
      // Let the original request error propagate.
    }
  }
}

export async function submitFizzAiJob(input: FizzAiSubmitJobInput): Promise<FizzAiSubmitResponse> {
  try {
    return await api.post<FizzAiSubmitResponse>("/aurora/ai/jobs", {
      timeout: 30_000,
      headers: input.context.workspaceId
        ? { "x-fizz-workspace-id": input.context.workspaceId }
        : undefined,
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
    emitUpgradeOn429(err);
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
    emitUpgradeOn429(err);
    throw err;
  }
}

/* ── prompt document builders (shared by the image + video studios) ───────── */

/**
 * Build the structured prompt document from the raw prompt text plus the
 * reference bindings whose `@Label` tokens appear in it. Falls back to a
 * single text node when nothing is mentioned.
 */
export function buildPromptDocument(
  prompt: string,
  references: FizzAiReferenceBinding[]
): FizzAiPromptDocument {
  const nodes = promptDocumentNodesFromMentions(prompt, references);
  return {
    version: 1,
    nodes: nodes.length > 0 ? nodes : [{ type: "text", text: prompt }],
  };
}

function promptDocumentNodesFromMentions(
  prompt: string,
  references: FizzAiReferenceBinding[]
): FizzAiPromptDocument["nodes"] {
  if (!prompt || references.length === 0) return [];

  const matches: Array<{ binding: FizzAiReferenceBinding; end: number; start: number }> = [];
  for (const binding of references) {
    const token = `@${binding.label}`;
    let cursor = 0;
    while (cursor < prompt.length) {
      const start = prompt.indexOf(token, cursor);
      if (start < 0) break;
      matches.push({ binding, start, end: start + token.length });
      cursor = start + token.length;
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

export async function getFizzAiJob(id: string): Promise<FizzAiJobView> {
  return api.get<FizzAiJobView>(`/aurora/ai/jobs/${encodeURIComponent(id)}`, {
    timeout: 15_000,
  });
}

export async function listFizzAiJobs(input: {
  workspaceId?: string;
  idempotencyKey?: string;
  documentId?: string;
  documentBlockId?: string;
  limit?: number;
  sourceSurface?: string;
  type?: FizzAiJobType;
}): Promise<FizzAiJobListResponse> {
  const params = new URLSearchParams();
  for (const key of ["idempotencyKey", "documentId", "documentBlockId"] as const) {
    if (input[key]) params.set(key, input[key]);
  }
  if (input.limit) params.set("limit", String(input.limit));
  if (input.sourceSurface) params.set("sourceSurface", input.sourceSurface);
  if (input.type) params.set("type", input.type);
  const query = params.toString();
  return api.get<FizzAiJobListResponse>(`/aurora/ai/jobs${query ? `?${query}` : ""}`, {
    timeout: 15_000,
    headers: input.workspaceId ? { "x-fizz-workspace-id": input.workspaceId } : undefined,
  });
}

export async function cancelFizzAiJob(id: string): Promise<FizzAiJobView> {
  return api.post<FizzAiJobView>(`/aurora/ai/jobs/${encodeURIComponent(id)}/cancel`, {
    timeout: 15_000,
  });
}
