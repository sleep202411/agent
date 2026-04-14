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
  /** English fallback title */
  title: string;
  /** i18n key for translation lookup (e.g. "model.resolution") */
  "x-i18n-key"?: string;
  description?: string;
  enum?: (string | number)[];
  /** Display labels for enum values (e.g. { "1080p": "1080p (1920×1080)" }) */
  "x-enum-labels"?: Record<string, string>;
  /** i18n keys for enum value labels */
  "x-enum-i18n"?: Record<string, string>;
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  format?: "uri" | "uri-image" | "uri-video";
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
  provider: string;
  type: "image" | "video" | "audio" | "lipsync" | "music";
  isDefault: boolean;
  cost: number;
  capabilities: string[];
  inputSchema: AiModelInputSchema;
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

function extractProvider(serviceCode?: string): string {
  if (!serviceCode) return "unknown";
  const parts = serviceCode.split("/");
  return parts.length > 1 ? parts[0] : "unknown";
}

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
      const label = obj.ratio && obj.dimension ? `${obj.ratio} (${obj.dimension})` : key;
      if (key) labels[key] = label;
    }
  }
  return labels;
}

import { getModelDescription } from "./ai-model-descriptions";

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
      "x-i18n-key": "model.size",
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
      "x-i18n-key": "model.videoLength",
      description: "seconds",
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
    provider: extractProvider(raw.serviceCode),
    type,
    isDefault: raw.isDefault ?? false,
    cost: Math.abs(raw.integralCost ?? 0),
    capabilities: type === "video" ? ["image-to-video"] : [type],
    inputSchema: {
      type: "object",
      properties,
    },
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
export function getFieldLabel(field: ModelParameterSchema, t?: (key: string) => string): string {
  if (t && field["x-i18n-key"]) {
    const translated = t(field["x-i18n-key"]);
    if (translated !== field["x-i18n-key"]) return translated;
  }
  return field.title;
}

/** Get display label for an enum value */
export function getEnumLabel(
  field: ModelParameterSchema,
  value: string | number,
  t?: (key: string) => string
): string {
  const key = String(value);
  if (t && field["x-enum-i18n"]?.[key]) {
    const translated = t(field["x-enum-i18n"][key]);
    if (translated !== field["x-enum-i18n"][key]) return translated;
  }
  return field["x-enum-labels"]?.[key] ?? key;
}

/** Get default values from schema */
export function getSchemaDefaults(schema: AiModelInputSchema): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    if (field.default !== undefined) {
      defaults[key] = field.default;
    }
  }
  return defaults;
}

// ─── Model Registry ───────────────────────────────────
// Frontend-maintained model capability specs.
// Extends AiModelInputSchema with media constraints, cost rules,
// and endpoint type. Backend returns raw model lists; registry
// enriches them for UI rendering and validation.

export interface ModelMediaConstraints {
  maxImages: number;
  maxVideos: number;
  maxAudios: number;
  maxTotal: number;
  imageFormats: string[];
  videoFormats: string[];
  audioFormats: string[];
  maxAudioDuration?: number;
}

export interface ModelRegistryEntry {
  /** Canonical model ID (serviceCode) sent to backend */
  id: string;
  /** Display label (serviceName) */
  label: string;
  /** Links to VideoModeConfig.id — determines which endpoint + payload + cost rules to use */
  mode: string;
  /** Base credit cost (absolute value of integralCost) */
  cost: number;
  /** Whether this is the default model for its mode */
  isDefault?: boolean;
  /** Standardized parameter schema — ALL models use this for UI rendering */
  inputSchema: AiModelInputSchema;
  /** Media upload constraints */
  media?: ModelMediaConstraints;
  /** Whether the model supports @-mention prompt references */
  supportsPromptRef?: boolean;
}

// ─── Schema builders ─────────────────────────────────

/** Build a standard inputSchema for video models with size + videoLength options */
function videoSchema(sizes: string[], videoLengths: number[]): AiModelInputSchema {
  return {
    type: "object",
    properties: {
      ...(sizes.length > 0
        ? {
            size: {
              type: "string",
              title: "Size",
              enum: sizes,
              "x-enum-labels": Object.fromEntries(sizes.map((s) => [s, s])),
              default: sizes[0],
              "x-order": 0,
            },
          }
        : {}),
      ...(videoLengths.length > 0
        ? {
            videoLength: {
              type: "integer",
              title: "Duration",
              enum: videoLengths,
              "x-enum-labels": Object.fromEntries(videoLengths.map((v) => [String(v), `${v}s`])),
              default: videoLengths[0],
              "x-order": 1,
            },
          }
        : {}),
    },
    required: [],
  };
}

/** Empty schema for models with no configurable params */
const EMPTY_SCHEMA: AiModelInputSchema = {
  type: "object",
  properties: {},
  required: [],
};

// ─── Multimodal mode models ──────────────────────────

const MULTIMODAL_MODELS: ModelRegistryEntry[] = [
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0",
    mode: "multimodal",
    cost: 40,
    isDefault: true,
    supportsPromptRef: true,
    inputSchema: {
      type: "object",
      properties: {
        ratio: {
          type: "string",
          title: "Ratio",
          "x-i18n-key": "model.ratio",
          enum: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
          "x-enum-labels": {
            "16:9": "16:9",
            "9:16": "9:16",
            "1:1": "1:1",
            "4:3": "4:3",
            "3:4": "3:4",
            "21:9": "21:9",
            "9:21": "9:21",
          },
          default: "16:9",
          "x-order": 0,
        },
        resolution: {
          type: "string",
          title: "Resolution",
          "x-i18n-key": "model.resolution",
          enum: ["480p", "720p", "1080p"],
          "x-enum-labels": { "480p": "480P", "720p": "720P", "1080p": "1080P" },
          default: "720p",
          "x-order": 1,
        },
        duration: {
          type: "integer",
          title: "Duration",
          "x-i18n-key": "model.duration",
          description: "seconds",
          enum: [4, 5, 6, 8, 10, 15],
          "x-enum-labels": {
            "4": "4s",
            "5": "5s",
            "6": "6s",
            "8": "8s",
            "10": "10s",
            "15": "15s",
          },
          default: 4,
          "x-order": 2,
        },
      },
      required: ["ratio", "resolution", "duration"],
    },
    media: {
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
      maxTotal: 12,
      imageFormats: ["image/jpeg", "image/png", "image/webp"],
      videoFormats: ["video/mp4", "video/webm"],
      audioFormats: ["audio/mpeg", "audio/wav"],
      maxAudioDuration: 15,
    },
  },
];

// ─── Basic (reference) mode models ───────────────────

const BASIC_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.6-i2v-flash",
    label: "Wan2.6",
    mode: "reference",
    cost: 100,
    isDefault: true,
    inputSchema: videoSchema(["720P", "1080P"], [5, 10, 15]),
  },
  {
    id: "wan2.7-i2v",
    label: "Wan2.7",
    mode: "reference",
    cost: 100,
    isDefault: true,
    inputSchema: videoSchema(["720P", "1080P"], [5, 10, 15]),
  },
  {
    id: "wan2.6-i2v",
    label: "Wan2.6-voice",
    mode: "reference",
    cost: 100,
    inputSchema: videoSchema(["720P", "1080P"], [5, 10, 15]),
  },
  {
    id: "kwaivgi/kling-v2.6",
    label: "Kling-2.6",
    mode: "reference",
    cost: 125,
    inputSchema: videoSchema(["16:9", "9:16", "1:1"], [5]),
  },
  {
    id: "minimax/hailuo-02",
    label: "hailuo-02",
    mode: "reference",
    cost: 125,
    inputSchema: videoSchema(["1080p"], [6]),
  },
  {
    id: "minimax/hailuo-2.3",
    label: "hailuo-2.3",
    mode: "reference",
    cost: 125,
    inputSchema: videoSchema(["1080p"], [6]),
  },
  {
    id: "Kling-3.0-720p",
    label: "Kling-3.0-720p",
    mode: "reference",
    cost: 140,
    inputSchema: videoSchema(["720p"], [5, 10]),
  },
  {
    id: "Kling-3.0-1080p",
    label: "Kling-3.0-1080p",
    mode: "reference",
    cost: 250,
    inputSchema: videoSchema(["1080p"], [5, 10]),
  },
  {
    id: "Hailuo-2.3-768p",
    label: "Hailuo-2.3-768p",
    mode: "reference",
    cost: 50,
    inputSchema: videoSchema(["768p"], [6, 10]),
  },
  {
    id: "Hailuo-2.3-1080p",
    label: "Hailuo-2.3-1080p",
    mode: "reference",
    cost: 90,
    inputSchema: videoSchema(["1080p"], [6, 10]),
  },
];

// ─── Frames (start/end frame) mode models ────────────

const FRAMES_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.6-i2v-flash",
    label: "Wan2.6",
    mode: "frames",
    cost: 120,
    isDefault: true,
    inputSchema: videoSchema(["720P", "1080P"], [5, 10, 15]),
  },
  {
    id: "wan2.7-i2v",
    label: "Wan2.7",
    mode: "frames",
    cost: 140,
    isDefault: true,
    inputSchema: videoSchema(["720P", "1080P"], [5, 10, 15]),
  },
  {
    id: "minimax/hailuo-02",
    label: "hailuo-02",
    mode: "frames",
    cost: 120,
    inputSchema: videoSchema(["1080p"], [6]),
  },
  {
    id: "Kling-3.0-720p",
    label: "Kling-3.0-720p",
    mode: "frames",
    cost: 140,
    inputSchema: videoSchema(["720p"], [5, 10]),
  },
  {
    id: "Kling-3.0-1080p",
    label: "Kling-3.0-1080p",
    mode: "frames",
    cost: 250,
    inputSchema: videoSchema(["1080p"], [5, 10]),
  },
];

// ─── Multi-reference mode models ─────────────────────

const MULTI_REF_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.1-vace-plus",
    label: "Wan2.1-vace",
    mode: "multiReference",
    cost: 120,
    isDefault: true,
    inputSchema: EMPTY_SCHEMA,
  },
];

// ─── Repaint mode models ─────────────────────────────

const REPAINT_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.1-vace-plus",
    label: "Wan2.1-vace",
    mode: "repaint",
    cost: 120,
    isDefault: true,
    inputSchema: EMPTY_SCHEMA,
  },
];

// ─── Local edit mode models ──────────────────────────

const LOCAL_EDIT_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.1-vace-plus",
    label: "Wan2.1-vace",
    mode: "localEdit",
    cost: 120,
    isDefault: true,
    inputSchema: EMPTY_SCHEMA,
  },
];

// ─── Extend mode models ──────────────────────────────

const EXTEND_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.1-vace-plus",
    label: "Wan2.1-vace",
    mode: "extend",
    cost: 120,
    isDefault: true,
    inputSchema: EMPTY_SCHEMA,
  },
];

// ─── Outpainting mode models ─────────────────────────

const OUTPAINTING_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.1-vace-plus",
    label: "Wan2.1-vace",
    mode: "outpainting",
    cost: 120,
    isDefault: true,
    inputSchema: EMPTY_SCHEMA,
  },
];

// ─── Lip sync mode models ────────────────────────────

const LIP_SYNC_MODELS: ModelRegistryEntry[] = [
  {
    id: "videoretalk",
    label: "Wan2.6",
    mode: "lipSync",
    cost: 120,
    isDefault: true,
    inputSchema: EMPTY_SCHEMA,
  },
];

// ─── Registry Map ─────────────────────────────────────

const MODEL_REGISTRY: ModelRegistryEntry[] = [
  ...BASIC_MODELS,
  ...FRAMES_MODELS,
  ...MULTI_REF_MODELS,
  ...MULTIMODAL_MODELS,
  ...REPAINT_MODELS,
  ...LOCAL_EDIT_MODELS,
  ...EXTEND_MODELS,
  ...OUTPAINTING_MODELS,
  ...LIP_SYNC_MODELS,
];

/** Look up model registry entry by serviceCode / model ID */
export function getModelRegistryEntry(serviceCode?: string): ModelRegistryEntry | undefined {
  if (!serviceCode) return undefined;
  const code = serviceCode.toLowerCase();
  return MODEL_REGISTRY.find((e) => e.id === code || code.includes(e.id));
}

/** Get all models for a given video mode */
export function getRegistryModels(mode: string): ModelRegistryEntry[] {
  return MODEL_REGISTRY.filter((e) => e.mode === mode);
}

/** Validate media counts against model constraints */
export function validateMedia(
  entry: ModelRegistryEntry,
  imageCount: number,
  videoCount: number,
  audioCount: number
): string | null {
  if (!entry.media) return null;
  const { maxImages, maxVideos, maxAudios, maxTotal } = entry.media;
  const total = imageCount + videoCount + audioCount;
  if (total > maxTotal) return `Total files cannot exceed ${maxTotal} (current: ${total})`;
  if (imageCount > maxImages) return `Images cannot exceed ${maxImages}`;
  if (videoCount > maxVideos) return `Videos cannot exceed ${maxVideos}`;
  if (audioCount > maxAudios) return `Audios cannot exceed ${maxAudios}`;
  return null;
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

export interface VideoModePayloadField {
  /** Key in the API request body */
  apiKey: string;
  /** Key in internal params (from task.input) */
  from: string;
  /** Transform before sending */
  transform?: "string" | "number";
}

// ── Cost types ──────────────────────────────────────

export interface CostMultiplier {
  /** Which param affects cost */
  param: string;
  /** How to calculate multiplier */
  type:
    | "map" // explicit value → multiplier mapping
    | "ratio" // value / base (fixed base number)
    | "ratioFirst" // value / first option value (dynamic base from options array)
    | "index" // position in options array (1-based)
    | "count"; // direct multiply by param value
  /** For "ratio": the fixed base value to divide by */
  base?: number;
  /** For "map": value → multiplier */
  map?: Record<string, number>;
  /**
   * For "ratioFirst" and "index": which options array to reference.
   * Passed via the `options` param in calculateVideoCost().
   */
  optionsKey?: string;
}

export interface CostConfig {
  /** Base cost: "model" = read from model.integralCost, or a fixed number */
  base: "model" | number;
  /** Multiplier dimensions applied sequentially */
  multipliers?: CostMultiplier[];
}

// ── Mode config ─────────────────────────────────────

export interface VideoModeConfig {
  /** Mode identifier (matches VideoMode type) */
  id: string;
  /** API endpoint path */
  endpoint: string;
  /** Payload field mappings */
  payload: VideoModePayloadField[];
  /** Required internal param keys for submission validation */
  required: string[];
  /** Cost calculation rules */
  cost: CostConfig;
}

// ── Functions ───────────────────────────────────────

/** Build API request payload from internal params using mode config. */
export function buildVideoPayload(
  config: VideoModeConfig,
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
export function getVideoModeConfig(modeId: string): VideoModeConfig | undefined {
  return VIDEO_MODES.find((m) => m.id === modeId);
}

/**
 * Calculate estimated credit cost for a video generation task.
 *
 * @param config  - The video mode's cost configuration
 * @param params  - Current form/task params (size, videoLength, resolution, duration, count, etc.)
 * @param model   - The selected model (for reading integralCost when base is "model")
 * @param options - Named option arrays for "index" and "ratioFirst" multipliers
 *                  e.g. { size: [{value:"720P"}, ...], videoLength: [{value:"5"}, ...] }
 */
export function calculateVideoCost(
  config: CostConfig,
  params: Record<string, unknown>,
  model?: { integralCost?: number },
  options?: Record<string, { value: string }[]>
): number {
  // 1. Determine base cost
  let cost = config.base === "model" ? Math.abs(model?.integralCost ?? 0) : config.base;

  if (cost === 0) return 0;

  // 2. Apply multipliers sequentially
  for (const m of config.multipliers ?? []) {
    const raw = params[m.param];
    if (raw == null || raw === "") continue;

    let multiplier = 1;
    const optList = options?.[m.optionsKey ?? m.param];

    switch (m.type) {
      case "map": {
        const key = String(raw).toLowerCase();
        multiplier = m.map?.[key] ?? 1;
        break;
      }
      case "ratio": {
        const value = Number(raw);
        const base = m.base ?? 1;
        multiplier = base > 0 && value > 0 ? value / base : 1;
        break;
      }
      case "ratioFirst": {
        // multiplier = ceil(value / first option value)
        const value = Number(raw);
        const firstVal = Number(optList?.[0]?.value ?? 0);
        multiplier = firstVal > 0 && value > 0 ? Math.ceil(value / firstVal) : 1;
        break;
      }
      case "index": {
        // multiplier = 1-based index in options array
        if (optList && optList.length > 0) {
          const idx = optList.findIndex((o) => o.value === String(raw));
          multiplier = Math.max(1, idx + 1);
        }
        break;
      }
      case "count": {
        multiplier = Math.max(1, Number(raw) || 1);
        break;
      }
    }

    cost *= multiplier;
  }

  return Math.round(cost);
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
const VIDEO_MODE_BASIC: VideoModeConfig = {
  id: "reference",
  endpoint: "/api/ai/task/video/generate/basic",
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "modelId", from: "model", transform: "string" },
    { apiKey: "startImageUrl", from: "referenceImageUrl" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
  required: ["prompt", "referenceImageUrl"],
  cost: {
    base: "model",
    multipliers: [
      { param: "size", type: "index" },
      { param: "videoLength", type: "ratioFirst" },
      { param: "count", type: "count" },
    ],
  },
};

/**
 * Multimodal (Seedance 2.0) mode
 *
 * POST /api/ai/task/video/generate/multimodalvideo
 * Request: { shotColumnId, shotId, prompt, model, images, ratio, resolution, duration }
 *
 * Cost: 40 (base per 4s) * resolutionMultiplier * duration/4 * count
 * Backend: 1080p=2x, 720p=1x, 480p=0.5x, duration scales linearly from 4s base
 */
const VIDEO_MODE_MULTIMODAL: VideoModeConfig = {
  id: "multimodal",
  endpoint: "/api/ai/task/video/generate/multimodalvideo",
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "images", from: "images" },
    { apiKey: "videos", from: "videos" },
    { apiKey: "audios", from: "audios" },
    { apiKey: "ratio", from: "ratio" },
    { apiKey: "resolution", from: "resolution" },
    { apiKey: "duration", from: "duration", transform: "number" },
    { apiKey: "note", from: "note" },
  ],
  required: ["prompt"],
  cost: {
    base: 40,
    multipliers: [
      { param: "resolution", type: "map", map: { "480p": 0.5, "720p": 1, "1080p": 2 } },
      { param: "duration", type: "ratio", base: 4 },
      { param: "count", type: "count" },
    ],
  },
};

// ─── Registry ───────────────────────────────────────

/**
 * Frames (start/end frame) mode
 *
 * POST /api/ai/task/video/generate/start-end-frame
 * Request: { shotColumnId, shotId, prompt, startFrameImageUrl, endFrameImageUrl, model, size, videoLength }
 *
 * Cost: same as basic — model.integralCost * sizeIndex * ceil(videoLength/base) * count
 */
const VIDEO_MODE_FRAMES: VideoModeConfig = {
  id: "frames",
  endpoint: "/api/ai/task/video/generate/start-end-frame",
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "startFrameImageUrl", from: "startFrameImageUrl" },
    { apiKey: "endFrameImageUrl", from: "endFrameImageUrl" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
  required: ["prompt"],
  cost: {
    base: "model",
    multipliers: [
      { param: "size", type: "index" },
      { param: "videoLength", type: "ratioFirst" },
      { param: "count", type: "count" },
    ],
  },
};

/**
 * Multi-reference mode
 *
 * POST /api/ai/task/video/generate/multiplereference
 * Request: { shotColumnId, shotId, prompt, model, refImageUrls, objOrBg, size, videoLength }
 *
 * Cost: same formula as basic (but model typically has no size/videoLength options → just baseCost * count)
 */
const VIDEO_MODE_MULTI_REFERENCE: VideoModeConfig = {
  id: "multiReference",
  endpoint: "/api/ai/task/video/generate/multiplereference",
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "refImageUrls", from: "refImageUrls" },
    { apiKey: "objOrBg", from: "objOrBg" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
  required: ["prompt", "refImageUrls"],
  cost: {
    base: "model",
    multipliers: [
      { param: "size", type: "index" },
      { param: "videoLength", type: "ratioFirst" },
      { param: "count", type: "count" },
    ],
  },
};

/**
 * Repaint mode
 * POST /api/ai/task/video/generate/videorepainting
 */
const VIDEO_MODE_REPAINT: VideoModeConfig = {
  id: "repaint",
  endpoint: "/api/ai/task/video/generate/videorepainting",
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "videoUrl", from: "videoUrl" },
    { apiKey: "controlCondition", from: "controlCondition" },
    { apiKey: "refImageUrl", from: "refImageUrl" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
  required: ["prompt", "videoUrl"],
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
};

/**
 * Local edit mode
 * POST /api/ai/task/video/generate/videoedit
 */
const VIDEO_MODE_LOCAL_EDIT: VideoModeConfig = {
  id: "localEdit",
  endpoint: "/api/ai/task/video/generate/videoedit",
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "videoUrl", from: "videoUrl" },
    { apiKey: "maskImageUrl", from: "maskImageUrl" },
    { apiKey: "maskType", from: "maskType" },
    { apiKey: "expandRatio", from: "expandRatio" },
    { apiKey: "size", from: "size" },
    { apiKey: "videoLength", from: "videoLength", transform: "number" },
  ],
  required: ["prompt", "videoUrl", "maskImageUrl"],
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
};

/**
 * Extend mode
 * POST /api/ai/task/video/generate/videoextension
 */
const VIDEO_MODE_EXTEND: VideoModeConfig = {
  id: "extend",
  endpoint: "/api/ai/task/video/generate/videoextension",
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
  required: ["prompt"],
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
};

/**
 * Outpainting mode
 * POST /api/ai/task/video/generate/videooutpainting
 */
const VIDEO_MODE_OUTPAINTING: VideoModeConfig = {
  id: "outpainting",
  endpoint: "/api/ai/task/video/generate/videooutpainting",
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
  required: ["prompt", "videoUrl"],
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
};

export const VIDEO_MODES: VideoModeConfig[] = [
  VIDEO_MODE_BASIC,
  VIDEO_MODE_FRAMES,
  VIDEO_MODE_MULTI_REFERENCE,
  VIDEO_MODE_MULTIMODAL,
  VIDEO_MODE_REPAINT,
  VIDEO_MODE_LOCAL_EDIT,
  VIDEO_MODE_EXTEND,
  VIDEO_MODE_OUTPAINTING,
];
