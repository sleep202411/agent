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

// ─── Model Description Map ──────────────────────────────

/**
 * Short descriptions for known models.
 * Key matches serviceCode or serviceName (case-insensitive).
 * Only descriptions — name comes from backend's serviceName.
 */
const MODEL_DESCRIPTION_MAP: Record<string, string> = {
  // Image
  "seed-1.6": "字节跳动 Seed 系列，擅长写实人像和复杂场景，色彩细腻",
  "wan2.5": "阿里通义万相，生成速度快，适合快速预览和迭代",
  "wan2.5-i2i-preview": "通义万相图生图模式，基于参考图风格化生成",
  "google/nano-banana": "Google 轻量模型，速度极快，适合草图和概念验证",
  "google/nano-banana-pro": "Google 增强版，画面质量更高，细节更丰富",
  "bytedance/seedream-4.5": "字节跳动最新模型，画面精致，风格多样，支持中文理解",
  "gem:3.1-2k": "GEM 系列 2K 超高清输出，适合需要大尺寸印刷的场景",
  "gem:3.1-1k": "GEM 系列 1K 标准输出，画质与速度的平衡之选",
  mj_imagine: "Midjourney 经典模式，一次生成 4 张 2x2 网格图",
  "mj:v7": "Midjourney 最新 v7 模型，艺术表现力强，风格独特",
  // Video
  "kwaivgi/kling-v2.6": "快手可灵 2.6，运动幅度大，适合动作场景",
  "wan2.6-i2v-flash": "通义万相极速版，3 秒出片，适合快速预览",
  "wan2.6-i2v": "通义万相标准版，画面稳定，动态自然",
  "minimax/hailuo-02": "MiniMax 海螺 02，人物表情细腻，适合对话场景",
  "minimax/hailuo-2.3": "海螺最新版，运动一致性强，画面更稳定",
  "kling-3.0-720p": "可灵 3.0 标清版，性价比高，适合批量生成",
  "kling-3.0-1080p": "可灵 3.0 高清版，画质细腻，适合最终成片",
  "hailuo-2.3-768p": "海螺 2.3 标清版，低成本快速生成",
  "hailuo-2.3-1080p": "海螺 2.3 高清版，画质清晰，适合正式输出",
};

function getModelDescription(raw: RawAiModel): string | undefined {
  const code = String(raw.serviceCode ?? "").toLowerCase();
  const name = String(raw.serviceName ?? "").toLowerCase();
  return MODEL_DESCRIPTION_MAP[code] ?? MODEL_DESCRIPTION_MAP[name];
}

// ─── Normalize ──────────────────────────────────────────

export function normalizeAiModel(raw: RawAiModel): AiModel {
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
    description: getModelDescription(raw),
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
