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
  cost: number;
  inputSchema: AiModelInputSchema;
  /** Max reference images (from backend description, default 3) */
  maxImages: number;
  /** Max reference videos (from backend description, default 0) */
  maxVideos: number;
  /** Max reference audios (from backend description, default 0) */
  maxAudios: number;
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
  if (path.includes("/video/")) return "video";
  if (path.includes("/audio/") || path.includes("/voice/")) return "audio";
  if (path.includes("/lipsync/")) return "lipsync";
  if (path.includes("/music/")) return "music";
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

export function normalizeAiModel(raw: RawAiModel, locale = "zh-CN"): AiModel {
  const desc = parseDescription(raw.description);
  const sizes = Array.isArray(desc.size) ? desc.size : [];
  const videoLengths = Array.isArray(desc.videoLength) ? desc.videoLength : [];
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
    const lengthValues = videoLengths
      .map((v: unknown) => Number(v))
      .filter((v: number) => !Number.isNaN(v));
    properties.videoLength = {
      type: "integer",
      title: "Duration",
      enum: lengthValues,
      "x-enum-labels": Object.fromEntries(lengthValues.map((v: number) => [String(v), `${v}s`])),
      default: lengthValues[0],
      "x-order": 1,
    };
  }

  return {
    id: raw.serviceCode ?? String(raw.id ?? ""),
    name: raw.serviceName ?? "",
    description: getModelDescription(raw.serviceCode, raw.serviceName, locale),
    type,
    isDefault: raw.isDefault ?? false,
    cost: Math.abs(raw.integralCost ?? 0),
    inputSchema: {
      type: "object",
      properties,
    },
    maxImages: typeof desc.maxImages === "number" ? desc.maxImages : 3,
    maxVideos: typeof desc.maxVideos === "number" ? desc.maxVideos : 0,
    maxAudios: typeof desc.maxAudios === "number" ? desc.maxAudios : 0,
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
 * - "ref:fieldName"      → references[fieldName][0].path → ossUrl (single asset)
 * - "refArray:fieldName" → references[fieldName][*].path → ossUrl[] (all assets)
 * - "refTags:fieldName"  → references[fieldName][*].typeTag → string[] (with default "obj")
 * - "formData:fieldName" → formData[fieldName] (dynamic form field)
 * - "setting:fieldName"  → modeSettings[fieldName]
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
  references: Record<string, { path: string; url?: string; typeTag?: string }[]>,
  formData: Record<string, unknown>,
  modeSettings: Record<string, unknown>,
  ossUrlFn: (path: string) => string
): { params: Record<string, unknown>; error?: { key: string; errorKey: string } } {
  const params: Record<string, unknown> = {};

  for (const field of config.inputs) {
    const [sourceType, sourceField] = field.source.split(":") as [string, string];
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
      required: true,
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
      required: true,
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
    { key: "images", source: "refArray:referenceImages" },
    { key: "ratio", source: "formData:ratio" },
    { key: "resolution", source: "formData:size" },
    { key: "duration", source: "formData:videoLength" },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "images", from: "images" },
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
      required: true,
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
