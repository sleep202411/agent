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
  type: "string" | "integer" | "number" | "boolean" | "array";
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
  format?: "uri" | "uri-image" | "uri-video" | "uri-audio";
  /** Render order (lower = first) */
  "x-order"?: number;
  // ── Array fields (type: "array") ──
  /** Schema for array items */
  items?: { type: string; format?: string };
  /** Maximum number of items */
  maxItems?: number;
  /** Accepted MIME types (e.g. ["image/jpeg", "image/png"]) */
  "x-accept"?: string[];
  /** Maximum duration in seconds (for audio/video references) */
  "x-max-duration"?: number;
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
// Each model's inputSchema contains ALL constraints: size, duration,
// reference limits (referenceImages/Videos/Audios with maxItems, x-accept).
// No separate media config — everything in one schema per OpenAPI conventions.

export interface ModelRegistryEntry {
  /** Canonical model ID (serviceCode) sent to backend */
  id: string;
  /** Display label (serviceName) */
  label: string;
  /** Links to AiModeConfig.id — determines endpoint, payload, cost, and ref config */
  mode: string;
  /** Base credit cost (absolute value of integralCost) */
  cost: number;
  /** Whether this is the default model for its mode */
  isDefault?: boolean;
  /** Standardized parameter schema — ALL models use this for UI rendering.
   *  Media constraints live here too (e.g. referenceImages with maxItems, x-accept). */
  inputSchema: AiModelInputSchema;
  /** Whether the model supports @-mention prompt references */
  supportsPromptRef?: boolean;
  /** Restrict to specific site regions. Omit = available everywhere.
   *  Values: "global" (.com), "cn" (.cn). Matches VITE_SITE_REGION. */
  regions?: string[];
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

/** Build a standard inputSchema for image models with ratio/dimension size options */
function imageSchema(
  sizes: { ratio: string; dimension: string; resolution?: string }[],
  ref?: { maxImages?: number; accept?: string[] }
): AiModelInputSchema {
  if (sizes.length === 0) return EMPTY_SCHEMA;
  const enumValues = sizes.map((s) => s.dimension);
  const labels: Record<string, string> = {};
  for (const s of sizes) {
    labels[s.dimension] = s.resolution
      ? `${s.ratio} (${s.dimension}) ${s.resolution}`
      : s.ratio !== s.dimension
        ? `${s.ratio} (${s.dimension})`
        : s.ratio;
  }
  const maxImages = ref?.maxImages ?? 5;
  const accept = ref?.accept ?? ["image/jpeg", "image/png", "image/webp"];
  return {
    type: "object",
    properties: {
      size: {
        type: "string",
        title: "Size",
        enum: enumValues,
        "x-enum-labels": labels,
        default: enumValues[0],
        "x-order": 0,
      },
      referenceImages: {
        type: "array",
        title: "Reference Images",
        maxItems: maxImages,
        items: { type: "string", format: "uri-image" },
        "x-accept": accept,
        "x-order": 99,
      },
    },
    required: [],
  };
}

const EMPTY_SCHEMA: AiModelInputSchema = {
  type: "object",
  properties: {},
  required: [],
};

/** Schema for image models with no size options but with reference support */
function imageRefOnly(maxImages = 5): AiModelInputSchema {
  return {
    type: "object",
    properties: {
      referenceImages: {
        type: "array",
        title: "Reference Images",
        maxItems: maxImages,
        items: { type: "string", format: "uri-image" },
        "x-accept": ["image/jpeg", "image/png", "image/webp"],
        "x-order": 99,
      },
    },
    required: [],
  };
}

// ─── Image generate models ──────────────────────────

const IMAGE_GENERATE_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.5-i2i-preview",
    label: "Wan2.5",
    mode: "imageGenerate",
    cost: 10,
    isDefault: true,
    inputSchema: imageSchema(
      [
        { ratio: "16:9", dimension: "1280*768" },
        { ratio: "1:1", dimension: "1280*1280" },
        { ratio: "9:16", dimension: "768*1280" },
        { ratio: "1:1", dimension: "1024*1024" },
        { ratio: "3:2", dimension: "1152*768" },
        { ratio: "2:3", dimension: "768*1152" },
        { ratio: "4:3", dimension: "1280*960" },
        { ratio: "3:4", dimension: "960*1280" },
      ],
      { maxImages: 3 }
    ),
  },
  {
    id: "ep-20260118112356-p7n89",
    label: "Seed-1.6",
    mode: "imageGenerate",
    cost: 25,
    inputSchema: imageSchema(
      [
        { ratio: "16:9", dimension: "2560x1440" },
        { ratio: "1:1", dimension: "2048x2048" },
        { ratio: "4:3", dimension: "2304x1728" },
        { ratio: "3:2", dimension: "2496x1664" },
        { ratio: "21:9", dimension: "3024x1296" },
        { ratio: "1:1", dimension: "4096x4096" },
        { ratio: "4:3", dimension: "4694x3520" },
        { ratio: "3:2", dimension: "4992x3328" },
        { ratio: "16:9", dimension: "5404x3040" },
        { ratio: "21:9", dimension: "6198x2656" },
      ],
      { maxImages: 5 }
    ),
  },
  {
    id: "google/nano-banana",
    label: "nano-banana 2.5",
    mode: "imageGenerate",
    cost: 10,
    inputSchema: imageSchema(
      [
        { ratio: "16:9", dimension: "16:9" },
        { ratio: "1:1", dimension: "1:1" },
        { ratio: "9:16", dimension: "9:16" },
        { ratio: "2:3", dimension: "2:3" },
        { ratio: "3:2", dimension: "3:2" },
        { ratio: "4:3", dimension: "4:3" },
        { ratio: "3:4", dimension: "3:4" },
        { ratio: "21:9", dimension: "21:9" },
        { ratio: "9:21", dimension: "9:21" },
      ],
      { maxImages: 6 }
    ),
  },
  {
    id: "google/nano-banana-pro",
    label: "nano-banana-pro",
    mode: "imageGenerate",
    cost: 20,
    inputSchema: imageSchema(
      [
        { ratio: "16:9", dimension: "16:9", resolution: "2K" },
        { ratio: "1:1", dimension: "1:1", resolution: "2K" },
        { ratio: "9:16", dimension: "9:16", resolution: "2K" },
        { ratio: "2:3", dimension: "2:3", resolution: "2K" },
        { ratio: "3:2", dimension: "3:2", resolution: "2K" },
        { ratio: "4:3", dimension: "4:3", resolution: "2K" },
        { ratio: "3:4", dimension: "3:4", resolution: "2K" },
        { ratio: "21:9", dimension: "21:9", resolution: "2K" },
        { ratio: "9:21", dimension: "9:21", resolution: "2K" },
      ],
      { maxImages: 11 }
    ),
  },
  {
    id: "bytedance/seedream-4.5",
    label: "seedream-4.5",
    mode: "imageGenerate",
    cost: 20,
    inputSchema: imageSchema(
      [
        { ratio: "16:9", dimension: "16:9", resolution: "2K" },
        { ratio: "1:1", dimension: "1:1", resolution: "2K" },
        { ratio: "9:16", dimension: "9:16", resolution: "2K" },
        { ratio: "2:3", dimension: "2:3", resolution: "2K" },
        { ratio: "3:2", dimension: "3:2", resolution: "2K" },
        { ratio: "4:3", dimension: "4:3", resolution: "2K" },
        { ratio: "3:4", dimension: "3:4", resolution: "2K" },
        { ratio: "21:9", dimension: "21:9", resolution: "2K" },
        { ratio: "9:21", dimension: "9:21", resolution: "2K" },
      ],
      { maxImages: 5 }
    ),
  },
  {
    id: "GEM:3.1-2K",
    label: "GEM:3.1-2K",
    mode: "imageGenerate",
    cost: 25,
    inputSchema: imageSchema(
      [
        { ratio: "16:9", dimension: "16:9", resolution: "2K" },
        { ratio: "1:1", dimension: "1:1", resolution: "2K" },
        { ratio: "9:16", dimension: "9:16", resolution: "2K" },
        { ratio: "2:3", dimension: "2:3", resolution: "2K" },
        { ratio: "3:2", dimension: "3:2", resolution: "2K" },
        { ratio: "4:3", dimension: "4:3", resolution: "2K" },
        { ratio: "3:4", dimension: "3:4", resolution: "2K" },
        { ratio: "21:9", dimension: "21:9", resolution: "2K" },
        { ratio: "9:21", dimension: "9:21", resolution: "2K" },
      ],
      { maxImages: 14 }
    ),
  },
  {
    id: "GEM:3.1-1K",
    label: "GEM:3.1-1K",
    mode: "imageGenerate",
    cost: 15,
    inputSchema: imageSchema(
      [
        { ratio: "16:9", dimension: "16:9", resolution: "2K" },
        { ratio: "1:1", dimension: "1:1", resolution: "2K" },
        { ratio: "9:16", dimension: "9:16", resolution: "2K" },
        { ratio: "2:3", dimension: "2:3", resolution: "2K" },
        { ratio: "3:2", dimension: "3:2", resolution: "2K" },
        { ratio: "4:3", dimension: "4:3", resolution: "2K" },
        { ratio: "3:4", dimension: "3:4", resolution: "2K" },
        { ratio: "21:9", dimension: "21:9", resolution: "2K" },
        { ratio: "9:21", dimension: "9:21", resolution: "2K" },
      ],
      { maxImages: 5 }
    ),
  },
  {
    id: "mj_imagine",
    label: "MJ (2x2 grid)",
    mode: "imageGenerate",
    cost: 25,
    inputSchema: imageRefOnly(5),
  },
  {
    id: "MJ:v7",
    label: "MJ:v7",
    mode: "imageGenerate",
    cost: 25,
    inputSchema: imageSchema(
      [
        { ratio: "16:9", dimension: "16:9", resolution: "2K" },
        { ratio: "1:1", dimension: "1:1", resolution: "2K" },
        { ratio: "9:16", dimension: "9:16", resolution: "2K" },
        { ratio: "2:3", dimension: "2:3", resolution: "2K" },
        { ratio: "3:2", dimension: "3:2", resolution: "2K" },
        { ratio: "4:3", dimension: "4:3", resolution: "2K" },
        { ratio: "3:4", dimension: "3:4", resolution: "2K" },
        { ratio: "21:9", dimension: "21:9", resolution: "2K" },
        { ratio: "9:21", dimension: "9:21", resolution: "2K" },
      ],
      { maxImages: 5 }
    ),
  },
];

// ─── Image edit models ──────────────────────────────

const IMAGE_EDIT_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.5-i2i-preview",
    label: "Wan2.5",
    mode: "imageEdit",
    cost: 35,
    isDefault: true,
    inputSchema: imageSchema(
      [
        { ratio: "16:9", dimension: "1280*768" },
        { ratio: "1:1", dimension: "1280*1280" },
        { ratio: "9:16", dimension: "768*1280" },
        { ratio: "1:1", dimension: "1024*1024" },
        { ratio: "3:2", dimension: "1152*768" },
        { ratio: "2:3", dimension: "768*1152" },
        { ratio: "4:3", dimension: "1280*960" },
        { ratio: "3:4", dimension: "960*1280" },
      ],
      { maxImages: 3 }
    ),
  },
];

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
        referenceImages: {
          type: "array",
          title: "Reference Images",
          maxItems: 9,
          items: { type: "string", format: "uri-image" },
          "x-accept": ["image/jpeg", "image/png", "image/webp"],
          "x-order": 90,
        },
        referenceVideos: {
          type: "array",
          title: "Reference Videos",
          maxItems: 3,
          items: { type: "string", format: "uri-video" },
          "x-accept": ["video/mp4", "video/webm"],
          "x-order": 91,
        },
        referenceAudios: {
          type: "array",
          title: "Reference Audio",
          maxItems: 3,
          items: { type: "string", format: "uri-audio" },
          "x-accept": ["audio/mpeg", "audio/wav"],
          "x-max-duration": 15,
          "x-order": 92,
        },
      },
      required: ["ratio", "resolution", "duration"],
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
  // {
  //   id: "wan2.7-i2v",
  //   label: "Wan2.7",
  //   mode: "reference",
  //   cost: 100,
  //   isDefault: true,
  //   inputSchema: videoSchema(["720P", "1080P"], [5, 10, 15]),
  // },
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
  // {
  //   id: "wan2.7-i2v",
  //   label: "Wan2.7",
  //   mode: "frames",
  //   cost: 140,
  //   isDefault: true,
  //   inputSchema: videoSchema(["720P", "1080P"], [5, 10, 15]),
  // },
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

// ─── Character fusion models ─────────────────────────

const CHARACTER_FUSION_MODELS: ModelRegistryEntry[] = [
  {
    id: "wan2.5-i2i-preview",
    label: "Wan2.5",
    mode: "characterFusion",
    cost: 10,
    isDefault: true,
    inputSchema: IMAGE_GENERATE_MODELS.find((m) => m.id === "wan2.5-i2i-preview")!.inputSchema,
  },
  {
    id: "ep-20260118112356-p7n89",
    label: "Seed-1.6",
    mode: "characterFusion",
    cost: 25,
    inputSchema: IMAGE_GENERATE_MODELS.find((m) => m.id === "ep-20260118112356-p7n89")!.inputSchema,
  },
  {
    id: "google/nano-banana",
    label: "nano-banana 2.5",
    mode: "characterFusion",
    cost: 10,
    inputSchema: IMAGE_GENERATE_MODELS.find((m) => m.id === "google/nano-banana")!.inputSchema,
  },
  {
    id: "google/nano-banana-pro",
    label: "nano-banana-pro",
    mode: "characterFusion",
    cost: 20,
    inputSchema: IMAGE_GENERATE_MODELS.find((m) => m.id === "google/nano-banana-pro")!.inputSchema,
  },
  {
    id: "bytedance/seedream-4.5",
    label: "seedream-4.5",
    mode: "characterFusion",
    cost: 20,
    inputSchema: IMAGE_GENERATE_MODELS.find((m) => m.id === "bytedance/seedream-4.5")!.inputSchema,
  },
  {
    id: "qwen-image-max",
    label: "Qwen",
    mode: "characterFusion",
    cost: 10,
    isDefault: true,
    inputSchema: imageRefOnly(5),
  },
];

const MODEL_REGISTRY: ModelRegistryEntry[] = [
  // Image
  ...IMAGE_GENERATE_MODELS,
  ...IMAGE_EDIT_MODELS,
  ...CHARACTER_FUSION_MODELS,
  // Video
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
/** Current site region from env, cached at module load */
const SITE_REGION =
  typeof import.meta !== "undefined"
    ? ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SITE_REGION ??
      "global")
    : "global";

/** Get all models for a given mode, filtered by current site region */
export function getRegistryModels(mode: string): ModelRegistryEntry[] {
  return MODEL_REGISTRY.filter(
    (e) => e.mode === mode && (!e.regions || e.regions.includes(SITE_REGION))
  );
}

/** Validate media counts against model constraints (reads from inputSchema) */
export function validateMedia(
  entry: ModelRegistryEntry,
  imageCount: number,
  videoCount: number,
  audioCount: number
): string | null {
  const props = entry.inputSchema?.properties;
  if (!props) return null;
  const maxImages = props.referenceImages?.maxItems ?? Infinity;
  const maxVideos = props.referenceVideos?.maxItems ?? 0;
  const maxAudios = props.referenceAudios?.maxItems ?? 0;
  if (imageCount > maxImages) return `Images cannot exceed ${maxImages}`;
  if (videoCount > maxVideos) return `Videos cannot exceed ${maxVideos}`;
  if (audioCount > maxAudios) return `Audios cannot exceed ${maxAudios}`;
  return null;
}

/** Get max reference count for a media type from inputSchema */
export function getModelMaxRef(
  entry: ModelRegistryEntry,
  type: "images" | "videos" | "audios" = "images"
): number {
  const key = `reference${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  return entry.inputSchema?.properties?.[key]?.maxItems ?? 0;
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
   * Passed via the `options` param in calculateModeCost().
   */
  optionsKey?: string;
}

export interface CostConfig {
  /** Base cost: "model" = read from model.integralCost, or a fixed number */
  base: "model" | number;
  /** Multiplier dimensions applied sequentially */
  multipliers?: CostMultiplier[];
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
  /** Cost calculation rules */
  cost: CostConfig;
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

/**
 * Calculate estimated credit cost for a video generation task.
 *
 * @param config  - The video mode's cost configuration
 * @param params  - Current form/task params (size, videoLength, resolution, duration, count, etc.)
 * @param model   - The selected model (for reading integralCost when base is "model")
 * @param options - Named option arrays for "index" and "ratioFirst" multipliers
 *                  e.g. { size: [{value:"720P"}, ...], videoLength: [{value:"5"}, ...] }
 */
export function calculateModeCost(
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
  cost: {
    base: "model",
    multipliers: [
      { param: "size", type: "index" },
      { param: "videoLength", type: "ratioFirst" },
      { param: "count", type: "count" },
    ],
  },
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
  cost: {
    base: "model",
    multipliers: [
      { param: "size", type: "index" },
      { param: "videoLength", type: "ratioFirst" },
      { param: "count", type: "count" },
    ],
  },
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
  cost: {
    base: "model",
    multipliers: [
      { param: "size", type: "index" },
      { param: "videoLength", type: "ratioFirst" },
      { param: "count", type: "count" },
    ],
  },
};

const MODE_VIDEO_MULTIMODAL: AiModeConfig = {
  type: "video",
  id: "multimodal",
  endpoint: "/api/ai/task/video/generate/multimodalvideo",
  inputs: [
    { key: "images", source: "refArray:referenceImages" },
    { key: "ratio", source: "formData:ratio" },
    { key: "resolution", source: "formData:resolution" },
    { key: "duration", source: "formData:duration" },
  ],
  payload: [
    { apiKey: "prompt", from: "prompt" },
    { apiKey: "model", from: "model", transform: "string" },
    { apiKey: "images", from: "images" },
    { apiKey: "ratio", from: "ratio" },
    { apiKey: "resolution", from: "resolution" },
    { apiKey: "duration", from: "duration", transform: "number" },
  ],
  cost: {
    base: 40,
    multipliers: [
      { param: "resolution", type: "map", map: { "480p": 0.5, "720p": 1, "1080p": 2 } },
      { param: "duration", type: "ratio", base: 4 },
      { param: "count", type: "count" },
    ],
  },
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
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
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
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
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
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
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
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
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
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
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
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
  refConfig: { field: "referenceImages", maxCount: 1, backfillFromPrompt: false },
};

const MODE_IMAGE_CHARACTER_FUSION: AiModeConfig = {
  type: "image",
  id: "characterFusion",
  label: "Character Fusion",
  endpoint: "/api/ai/image/compose/character",
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
  cost: { base: "model", multipliers: [{ param: "count", type: "count" }] },
  refConfig: { field: "referenceImages", maxCount: 2, backfillFromPrompt: false },
};

const MODE_IMAGE_REPAINT: AiModeConfig = {
  type: "image",
  id: "imageRepaint",
  label: "Repaint",
  endpoint: "",
  inputs: [],
  payload: [],
  cost: { base: 0 },
  disabled: true,
};

const MODE_IMAGE_ERASE: AiModeConfig = {
  type: "image",
  id: "imageErase",
  label: "Erase",
  endpoint: "",
  inputs: [],
  payload: [],
  cost: { base: 0 },
  disabled: true,
};

const MODE_IMAGE_ENHANCE: AiModeConfig = {
  type: "image",
  id: "imageEnhance",
  label: "Enhance",
  endpoint: "",
  inputs: [],
  payload: [],
  cost: { base: 0 },
  disabled: true,
};

const MODE_IMAGE_CUTOUT: AiModeConfig = {
  type: "image",
  id: "imageCutout",
  label: "Cutout",
  endpoint: "",
  inputs: [],
  payload: [],
  cost: { base: 0 },
  disabled: true,
};

const MODE_IMAGE_MULTI_VIEW: AiModeConfig = {
  type: "image",
  id: "imageMultiView",
  label: "Multi-View",
  endpoint: "",
  inputs: [],
  payload: [],
  cost: { base: 0 },
  disabled: true,
};

// ─── Mode Registry ──────────────────────────────────

export const AI_MODES: AiModeConfig[] = [
  // Image
  MODE_IMAGE_GENERATE,
  MODE_IMAGE_EDIT,
  MODE_IMAGE_CHARACTER_FUSION,
  MODE_IMAGE_REPAINT,
  MODE_IMAGE_ERASE,
  MODE_IMAGE_ENHANCE,
  MODE_IMAGE_CUTOUT,
  MODE_IMAGE_MULTI_VIEW,
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
