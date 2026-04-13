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

export interface ModelCostRule {
  baseDuration: number;
  resolutionMultipliers: Record<string, number>;
}

export interface ModelRegistryEntry {
  inputSchema: AiModelInputSchema;
  media?: ModelMediaConstraints;
  costRule?: ModelCostRule;
  endpoint: "multimodal" | "legacy";
  supportsPromptRef: boolean;
}

// ─── Seedance 2.0 ─────────────────────────────────────

const SEEDANCE_2_0: ModelRegistryEntry = {
  endpoint: "multimodal",
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
  costRule: {
    baseDuration: 4,
    resolutionMultipliers: { "480p": 0.5, "720p": 1, "1080p": 2 },
  },
};

// ─── Registry Map ─────────────────────────────────────

const MODEL_REGISTRY: Record<string, ModelRegistryEntry> = {
  "seedance-2.0": SEEDANCE_2_0,
  "seedance2.0": SEEDANCE_2_0,
  seedance: SEEDANCE_2_0,
};

/** Look up model registry entry by serviceCode */
export function getModelRegistryEntry(serviceCode?: string): ModelRegistryEntry | undefined {
  if (!serviceCode) return undefined;
  const code = serviceCode.toLowerCase();
  if (MODEL_REGISTRY[code]) return MODEL_REGISTRY[code];
  for (const [key, entry] of Object.entries(MODEL_REGISTRY)) {
    if (code.includes(key)) return entry;
  }
  return undefined;
}

/** Calculate estimated cost based on registry cost rules */
export function estimateCost(
  entry: ModelRegistryEntry,
  baseCost: number,
  resolution?: string,
  duration?: number
): number {
  if (!entry.costRule) return baseCost;
  const { baseDuration, resolutionMultipliers } = entry.costRule;
  let cost = baseCost;
  if (resolution && resolutionMultipliers[resolution] !== undefined) {
    cost = baseCost * resolutionMultipliers[resolution];
  }
  if (duration && duration !== baseDuration) {
    cost = (cost * duration) / baseDuration;
  }
  return Math.round(cost);
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
