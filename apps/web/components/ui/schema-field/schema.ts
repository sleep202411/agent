/**
 * Standardized AI model schema, inspired by OpenAPI/Replicate conventions.
 *
 * Backend currently returns a non-standard format with a JSON-stringified
 * `description` field. This module normalizes it into a typed schema that
 * the frontend can consume uniformly.
 *
 * Strategy: normalize for display only, pass-through values on submit
 * (enum values match backend expectations exactly).
 */

// ─── Schema Types ───────────────────────────────────────

export interface ModelParameterSchema {
  type: "string" | "integer" | "number" | "boolean";
  title: string;
  enum?: (string | number)[];
  "x-enum-labels"?: Record<string, string>;
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  /** Render order (lower = first) */
  "x-order"?: number;
}

export interface AiModelInputSchema {
  type: "object";
  properties: Record<string, ModelParameterSchema>;
  required?: string[];
}

export interface AiModel {
  id: string;
  name: string;
  description?: string;
  type: "image" | "video" | "audio" | "lipsync" | "music";
  isDefault: boolean;
  /** Flat fallback (integralCost). Video models with costTable price by size × length. */
  cost: number;
  /**
   * Optional per-size unit cost table from `description.cost`.
   * Shape: Array<{ [size]: creditsPerSecond }>. Total = unit × videoLength × count.
   */
  costTable?: Array<Record<string, number>>;
  inputSchema: AiModelInputSchema;
  /** Max reference images, from description `images: [min, max]` tuple (0 = not supported) */
  maxImages: number;
  /** Max reference videos, from description `videos: [min, max]` tuple (0 = not supported) */
  maxVideos: number;
  /** Max reference audios, from description `audios: [min, max]` tuple (0 = not supported) */
  maxAudios: number;
  /** Min reference images, from description `images: [min, max]` tuple */
  minImages: number;
  /** Min reference videos, from description `videos: [min, max]` tuple */
  minVideos: number;
  /** Min reference audios, from description `audios: [min, max]` tuple */
  minAudios: number;
}

// ─── Raw Backend Type ───────────────────────────────────

export interface RawAiModel {
  id?: number;
  serviceName?: string;
  serviceCode?: string;
  description?: string;
  integralCost?: number;
  isDefault?: boolean;
  status?: number;
  sortOrder?: number;
  path?: string;
  [key: string]: unknown;
}

// ─── Helpers ────────────────────────────────────────────

function inferType(path?: string): AiModel["type"] {
  if (!path) return "image";
  if (path.includes("/video/lip/sync") || path.includes("/lipsync/")) return "lipsync";
  if (/(?:^|\/)music(?:\/|$)/.test(path)) return "music";
  if (path.includes("/video/")) return "video";
  if (path.includes("/audio/") || path.includes("/voice/")) return "audio";
  if (path.includes("/image/")) return "image";
  return "image";
}

function parseDescription(desc?: string): Record<string, unknown> {
  if (!desc) return {};
  try {
    return JSON.parse(desc);
  } catch {
    return {};
  }
}

function buildSizeLabels(sizes: unknown[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const s of sizes) {
    if (typeof s === "string") {
      labels[s] = s;
    } else if (typeof s === "object" && s) {
      const obj = s as { ratio?: string; dimension?: string };
      const key = obj.dimension || obj.ratio || "";
      if (key) labels[key] = key;
    }
  }
  return labels;
}

import { getModelDescription } from "./descriptions";

// ─── Normalize ──────────────────────────────────────────

/** Read the upper bound from a `[min, max]` tuple returned by backend. */
function parseMaxCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  const nums = raw.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  return nums.length > 0 ? Math.max(...nums) : 0;
}

/** Read the lower bound from a `[min, max]` tuple returned by backend. */
function parseMinCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  const nums = raw.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  return nums.length > 0 ? Math.max(0, Math.min(...nums)) : 0;
}

export function normalizeAiModel(raw: RawAiModel, locale = "en-US"): AiModel {
  const desc = parseDescription(raw.description);
  const sizes = Array.isArray(desc.size) ? desc.size : [];
  const videoLengths = Array.isArray(desc.videoLength) ? desc.videoLength : [];
  const ratios = Array.isArray(desc.ratio)
    ? desc.ratio.map((v: unknown) => String(v ?? "").trim()).filter(Boolean)
    : [];
  const costTable = Array.isArray(desc.cost)
    ? desc.cost
        .filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null
        )
        .map((item) =>
          Object.fromEntries(
            Object.entries(item)
              .map(([k, v]) => [k, Number(v)] as const)
              .filter(([, v]) => Number.isFinite(v))
          )
        )
        .filter((item) => Object.keys(item).length > 0)
    : [];
  const type = inferType(raw.path);

  const properties: Record<string, ModelParameterSchema> = {};

  if (sizes.length > 0) {
    const sizeLabels = buildSizeLabels(sizes);
    const enumValues = Object.keys(sizeLabels);
    properties.size = {
      type: "string",
      title: "Size",
      enum: enumValues,
      "x-enum-labels": sizeLabels,
      default: enumValues[0],
      "x-order": 0,
    };
  }

  if (videoLengths.length > 0) {
    const lengthValues = [
      ...new Set(
        videoLengths.map((v: unknown) => Number(v)).filter((v: number) => Number.isFinite(v))
      ),
    ];
    properties.videoLength = {
      type: "integer",
      title: "Duration",
      enum: lengthValues,
      "x-enum-labels": Object.fromEntries(lengthValues.map((v: number) => [String(v), `${v}s`])),
      default: lengthValues[0],
      "x-order": 1,
    };
  }

  if (ratios.length > 0) {
    properties.ratio = {
      type: "string",
      title: "Ratio",
      enum: ratios,
      "x-enum-labels": Object.fromEntries(ratios.map((r) => [r, r])),
      default: ratios[0],
      "x-order": 2,
    };
  }

  return {
    id: raw.serviceCode ?? String(raw.id ?? ""),
    name: raw.serviceName ?? "",
    description: getModelDescription(raw.serviceCode, raw.serviceName, locale),
    type,
    isDefault: raw.isDefault ?? false,
    cost: Math.abs(raw.integralCost ?? 0),
    costTable: costTable.length > 0 ? costTable : undefined,
    inputSchema: {
      type: "object",
      properties,
    },
    maxImages: parseMaxCount(desc.images),
    maxVideos: parseMaxCount(desc.videos),
    maxAudios: parseMaxCount(desc.audios),
    minImages: parseMinCount(desc.images),
    minVideos: parseMinCount(desc.videos),
    minAudios: parseMinCount(desc.audios),
  };
}

// ─── Schema Utilities ───────────────────────────────────

/** Get sorted parameter entries from schema */
export function getSchemaFields(schema: AiModelInputSchema) {
  return Object.entries(schema.properties).sort(
    ([, a], [, b]) => (a["x-order"] ?? 99) - (b["x-order"] ?? 99)
  );
}

/** Get display label for a parameter field */
export function getFieldLabel(field: ModelParameterSchema): string {
  return field.title;
}

/** Get display label for an enum value */
export function getEnumLabel(field: ModelParameterSchema, value: string | number): string {
  return field["x-enum-labels"]?.[String(value)] ?? String(value);
}

/**
 * Compute total credits for a generation.
 *
 * Video models may expose `costTable` like `[{"720p": 20}]` (credits per second per size).
 * Total = unit(size) × videoLength × count. Falls back to flat `cost × count` when
 * the table is absent or the selected size has no entry.
 */
export function calcModelCost(
  model: AiModel | null | undefined,
  opts: { size?: string | number; videoLength?: string | number; count?: number } = {}
): number {
  if (!model) return 0;
  const count = Math.max(1, Number(opts.count) || 1);
  const size = opts.size != null ? String(opts.size) : "";
  const length = Number(opts.videoLength) || 0;

  if (model.costTable && size) {
    for (const entry of model.costTable) {
      const unit = entry?.[size];
      if (typeof unit === "number" && Number.isFinite(unit)) {
        const perItem = length > 0 ? unit * length : unit;
        return perItem * count;
      }
    }
  }
  return model.cost * count;
}

// ─── Video Mode Configurations ──────────────────────
//
// Each mode defines:
// - endpoint + payload mapping (how to call the API)
// - cost rules (how to calculate credits)
//
// All video endpoints are async: POST returns taskId as `data: number`.
// Response shape: { success: boolean, code: string, message: string, data: number }

// ── Payload types ───────────────────────────────────

export interface AiModePayloadField {
  /** Key in the API request body */
  apiKey: string;
  /** Key in internal params (from task.input) */
  from: string;
  /** Transform before sending */
  transform?: "string" | "number";
}

// ── Input source types ──────────────────────────────

/**
 * Describes how to extract a parameter from the current state.
 *
 * Source types:
 * - "ref:fieldName"                   → references[fieldName][0].path → ossUrl (single asset)
 * - "refArray:fieldName"              → references[fieldName][*].path → ossUrl[] (all assets)
 * - "refArrayByType:fieldName:kind"   → filter by media kind (image/video/audio) by extension
 * - "refTags:fieldName"               → references[fieldName][*].typeTag → string[] (with default "obj")
 * - "formData:fieldName"              → formData[fieldName] (dynamic form field)
 * - "setting:fieldName"               → modeSettings[fieldName]
 */
export interface AiModeInputField {
  /** Key to set in task input */
  key: string;
  /** Source descriptor string (see above) */
  source: string;
  /** Whether this field must be non-empty to submit */
  required?: boolean;
  /** i18n key for the validation error toast */
  errorKey?: string;
}

// ── Mode config ─────────────────────────────────────

/** Describes how this mode uses reference images for backfill/truncation */
export interface AiModeRefConfig {
  /** Which references field to backfill into (e.g. "referenceImages", "firstFrames") */
  field: string;
  /** Maximum number of items allowed */
  maxCount: number;
  /** Whether to backfill from prompt mentions on open/mode switch */
  backfillFromPrompt?: boolean;
}

export interface AiModeConfig {
  /** Mode identifier */
  id: string;
  /** Generation type */
  type: "image" | "video";
  /** Display label (for UI) */
  label?: string;
  /** API endpoint path */
  endpoint: string;
  /** How to extract params from state → task.input (validation + extraction) */
  inputs: AiModeInputField[];
  /** How to map task.input → API request body */
  payload: AiModePayloadField[];
  /** Reference group configuration (backfill + maxCount) */
  refConfig?: AiModeRefConfig;
  /** Mode not yet supported — show in UI as disabled */
  disabled?: boolean;
}

// ── Functions ───────────────────────────────────────

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "heic", "heif"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "flv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac"]);

/** Classify an asset path by file extension. Falls back to "image" for unknown. */
export function classifyMediaByPath(path: string): "image" | "video" | "audio" {
  const match = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(path ?? "");
  const ext = match?.[1]?.toLowerCase() ?? "";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "image";
}

/** Classify a reference asset: explicit `kind` wins over path extension. */
export function classifyAsset(asset: {
  path: string;
  kind?: "image" | "video" | "audio";
}): "image" | "video" | "audio" {
  return asset.kind ?? classifyMediaByPath(asset.path);
}

/**
 * Resolve input fields from the current video instance state.
 * Returns the built inputBase and any validation error (first failed required field).
 *
 * @param config - The video mode config
 * @param references - VideoInstanceState.references
 * @param formData - VideoInstanceState.formData (as Record for dynamic fields)
 * @param modeSettings - VideoInstanceState.modeSettings (as Record)
 * @param ossUrlFn - Function to convert storage path to full URL
 */
export function resolveModeInputs(
  config: AiModeConfig,
  references: Record<
    string,
    { path: string; url?: string; typeTag?: string; kind?: "image" | "video" | "audio" }[]
  >,
  formData: Record<string, unknown>,
  modeSettings: Record<string, unknown>,
  ossUrlFn: (path: string) => string
): { params: Record<string, unknown>; error?: { key: string; errorKey: string } } {
  const params: Record<string, unknown> = {};

  for (const field of config.inputs) {
    const [sourceType, sourceField, sourceArg] = field.source.split(":");
    let value: unknown;

    switch (sourceType) {
      case "ref": {
        // Single reference asset → ossUrl(first item's path)
        const assets = references[sourceField];
        const path = assets?.[0]?.path;
        value = path ? ossUrlFn(path) : undefined;
        break;
      }
      case "refArray": {
        // All reference assets → ossUrl[] of non-empty paths
        const assets = references[sourceField];
        const urls = (assets ?? []).filter((a) => a.path).map((a) => ossUrlFn(a.path));
        value = urls.length > 0 ? urls : undefined;
        break;
      }
      case "refArrayByType": {
        // Filter by media kind — explicit asset.kind wins over path-extension fallback
        const kind = sourceArg as "image" | "video" | "audio";
        const assets = references[sourceField];
        const urls = (assets ?? [])
          .filter((a) => a.path && classifyAsset(a) === kind)
          .map((a) => ossUrlFn(a.path));
        value = urls.length > 0 ? urls : undefined;
        break;
      }
      case "refTags": {
        // All reference assets → typeTag[] with default "obj"
        const assets = references[sourceField];
        value = (assets ?? []).map((a) => a.typeTag || "obj");
        break;
      }
      case "formData": {
        value = formData[sourceField];
        break;
      }
      case "setting": {
        value = modeSettings[sourceField];
        break;
      }
    }

    // Validate required
    if (field.required) {
      const isEmpty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
      if (isEmpty) {
        return { params, error: { key: field.key, errorKey: field.errorKey ?? "requiredField" } };
      }
    }

    if (value != null && value !== "") {
      params[field.key] = value;
    }
  }

  return { params };
}

/** Build API request payload from internal params using mode config. */
export function buildModePayload(
  config: AiModeConfig,
  params: Record<string, unknown>,
  shotId: string,
  shotColumnId: string
): Record<string, unknown> {
  const body: Record<string, unknown> = { shotId, shotColumnId };
  for (const field of config.payload) {
    let value = params[field.from];
    if (value == null || value === "") continue;
    if (field.transform === "number") value = Number(value);
    else if (field.transform === "string") value = String(value);
    body[field.apiKey] = value;
  }
  return body;
}

/** Get mode config by mode id. */
export function getModeConfig(modeId: string): AiModeConfig | undefined {
  return AI_MODES.find((m) => m.id === modeId);
}

/** Get all modes for a given type (image/video), optionally including disabled */
export function getModesByType(type: "image" | "video", includeDisabled = false): AiModeConfig[] {
  return AI_MODES.filter((m) => m.type === type && (includeDisabled || !m.disabled));
}

// ─── Mode Definitions ───────────────────────────────

/**
 * Basic (reference image) mode
 *
 * POST /api/ai/task/video/generate/basic
 * Request: { shotColumnId, shotId, prompt, startImageUrl, modelId, size, videoLength }
 *
 * Cost: model.integralCost * sizeMultiplier * durationMultiplier * count
 */
const MODE_VIDEO_BASIC: AiModeConfig = {
  type: "video",
  id: "reference",
  endpoint: "/api/ai/task/video/generate/basic",
  inputs: [
    {
      key: "referenceImageUrl",
      source: "ref:referenceImages",
      errorKey: "selectReferenceImage",
    },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "modelId", from: "model", transform: "string" },
    { apiKey: "startImageUrl", from: "referenceImageUrl" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
};

const MODE_VIDEO_FRAMES: AiModeConfig = {
  type: "video",
  id: "frames",
  endpoint: "/api/ai/task/video/generate/start-end-frame",
  inputs: [
    // { key: "startFrameImageUrl", source: "ref:firstFrames", required: false, errorKey: "uploadFirstFrame" },
    { key: "startFrameImageUrl", source: "ref:firstFrames", required: false },
    { key: "endFrameImageUrl", source: "ref:lastFrames" },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "startFrameImageUrl", from: "startFrameImageUrl" },
    { apiKey: "endFrameImageUrl", from: "endFrameImageUrl" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
};

const MODE_VIDEO_MULTI_REFERENCE: AiModeConfig = {
  type: "video",
  id: "multiReference",
  endpoint: "/api/ai/task/video/generate/multiplereference",
  inputs: [
    {
      key: "refImageUrls",
      source: "refArray:multiRefImages",
      errorKey: "uploadReferenceImage",
    },
    { key: "objOrBg", source: "refTags:multiRefImages" },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "refImageUrls", from: "refImageUrls" },
    { apiKey: "objOrBg", from: "objOrBg" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
};

const MODE_VIDEO_MULTIMODAL: AiModeConfig = {
  type: "video",
  id: "multimodal",
  endpoint: "/api/ai/task/video/generate/multimodalvideo",
  inputs: [
    { key: "images", source: "refArrayByType:referenceImages:image" },
    { key: "videos", source: "refArrayByType:referenceImages:video" },
    { key: "audios", source: "refArrayByType:referenceImages:audio" },
    { key: "ratio", source: "formData:ratio" },
    { key: "resolution", source: "formData:size" },
    { key: "duration", source: "formData:videoLength" },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "images", from: "images" },
    { apiKey: "videos", from: "videos" },
    { apiKey: "audios", from: "audios" },
    { apiKey: "ratio", from: "ratio" },
    { apiKey: "resolution", from: "resolution" },
    { apiKey: "duration", from: "duration", transform: "number" },
  ],
};

const MODE_VIDEO_REPAINT: AiModeConfig = {
  type: "video",
  id: "repaint",
  endpoint: "/api/ai/task/video/generate/videorepainting",
  inputs: [
    {
      key: "videoUrl",
      source: "ref:repaintRefVideos",
      errorKey: "selectVideoFirst",
    },
    { key: "controlCondition", source: "setting:controlCondition" },
    { key: "refImageUrl", source: "ref:repaintRefImage" },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "videoUrl", from: "videoUrl" },
    { apiKey: "controlCondition", from: "controlCondition" },
    { apiKey: "refImageUrl", from: "refImageUrl" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
};

const MODE_VIDEO_LOCAL_EDIT: AiModeConfig = {
  type: "video",
  id: "localEdit",
  endpoint: "/api/ai/task/video/generate/videoedit",
  inputs: [
    {
      key: "videoUrl",
      source: "ref:localEditRefVideo",
      required: true,
      errorKey: "selectVideoFirst",
    },
    {
      key: "maskImageUrl",
      source: "ref:localEditMaskImage",
      required: true,
      errorKey: "uploadMaskImage",
    },
    { key: "maskType", source: "setting:maskType" },
    { key: "expandRatio", source: "setting:expandRatio" },
    { key: "maskFrameId", source: "setting:maskFrameId" },
    { key: "refImageUrl", source: "ref:localEditRefImage" },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "videoUrl", from: "videoUrl" },
    { apiKey: "maskImageUrl", from: "maskImageUrl" },
    { apiKey: "maskType", from: "maskType" },
    { apiKey: "expandRatio", from: "expandRatio" },
    { apiKey: "maskFrameId", from: "maskFrameId" },
    { apiKey: "refImageUrl", from: "refImageUrl" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
};

const MODE_VIDEO_EXTEND: AiModeConfig = {
  type: "video",
  id: "extend",
  endpoint: "/api/ai/task/video/generate/videoextension",
  inputs: [
    { key: "firstClipUrl", source: "ref:extendFirstClip" },
    { key: "lastClipUrl", source: "ref:extendLastClip" },
    { key: "firstFrameUrl", source: "ref:extendFirstFrame" },
    { key: "lastFrameUrl", source: "ref:extendLastFrame" },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "firstClipUrl", from: "firstClipUrl" },
    { apiKey: "lastClipUrl", from: "lastClipUrl" },
    { apiKey: "firstFrameUrl", from: "firstFrameUrl" },
    { apiKey: "lastFrameUrl", from: "lastFrameUrl" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
};

const MODE_VIDEO_OUTPAINTING: AiModeConfig = {
  type: "video",
  id: "outpainting",
  endpoint: "/api/ai/task/video/generate/videooutpainting",
  inputs: [
    {
      key: "videoUrl",
      source: "ref:outpaintingRefVideo",
      required: true,
      errorKey: "selectVideoFirst",
    },
    { key: "topScale", source: "setting:outpaintingTop" },
    { key: "bottomScale", source: "setting:outpaintingBottom" },
    { key: "leftScale", source: "setting:outpaintingLeft" },
    { key: "rightScale", source: "setting:outpaintingRight" },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "videoUrl", from: "videoUrl" },
    { apiKey: "topScale", from: "topScale" },
    { apiKey: "bottomScale", from: "bottomScale" },
    { apiKey: "leftScale", from: "leftScale" },
    { apiKey: "rightScale", from: "rightScale" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
};

// ─── Image Mode Definitions ─────────────────────────

const MODE_IMAGE_GENERATE: AiModeConfig = {
  type: "image",
  id: "imageGenerate",
  label: "Generate",
  endpoint: "/api/ai/image/generate/basic",
  inputs: [{ key: "referenceImageUrl", source: "ref:referenceImages" }],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "size", from: "size" },
    { apiKey: "referenceImageUrl", from: "referenceImageUrl" },
  ],
  refConfig: { field: "referenceImages", maxCount: 5, backfillFromPrompt: true },
};

const MODE_IMAGE_EDIT: AiModeConfig = {
  type: "image",
  id: "imageEdit",
  label: "Edit",
  endpoint: "/api/ai/image/edit/wan",
  inputs: [
    {
      key: "referenceImageUrl",
      source: "ref:referenceImages",
      required: true,
      errorKey: "selectReferenceImage",
    },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "size", from: "size" },
    { apiKey: "referenceImageUrl", from: "referenceImageUrl" },
  ],
  refConfig: { field: "referenceImages", maxCount: 1, backfillFromPrompt: false },
};

// ─── Mode Registry ──────────────────────────────────

export const AI_MODES: AiModeConfig[] = [
  // Image
  MODE_IMAGE_GENERATE,
  MODE_IMAGE_EDIT,
  // Video
  MODE_VIDEO_BASIC,
  MODE_VIDEO_FRAMES,
  MODE_VIDEO_MULTI_REFERENCE,
  MODE_VIDEO_MULTIMODAL,
  MODE_VIDEO_REPAINT,
  MODE_VIDEO_LOCAL_EDIT,
  MODE_VIDEO_EXTEND,
  MODE_VIDEO_OUTPAINTING,
];
