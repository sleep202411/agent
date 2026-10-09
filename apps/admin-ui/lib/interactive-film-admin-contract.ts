import { ExperienceStableIdSchema } from "@repo/shared/experience-runtime/common";

export const INTERACTIVE_FILM_STATUSES = ["draft", "reviewing", "published", "offline"] as const;

export type InteractiveFilmStatus = (typeof INTERACTIVE_FILM_STATUSES)[number];
export type AdminInteractiveFilmStatusFilter = "all" | InteractiveFilmStatus;
export type InteractiveFilmAdminAction =
  | { action: "approve" }
  | { action: "reject"; reason: string }
  | { action: "offline" };

export type AdminInteractiveFilmSummary = {
  gameId: string;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  status: InteractiveFilmStatus;
  draftVersion: string | null;
  currentVersion: string | null;
  updatedAt: string | null;
};

export type AdminInteractiveFilmStats = Record<InteractiveFilmStatus | "total", number>;

export type AdminInteractiveFilmList = {
  list: AdminInteractiveFilmSummary[];
  total: number;
  stats: AdminInteractiveFilmStats;
};

export type AdminInteractiveFilmDetail = AdminInteractiveFilmSummary & {
  creatorId: string | null;
  rejectReason: string | null;
  draftManifestUrl: string | null;
  manifestUrl: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  offlineAt: string | null;
};

const STATUS_SET = new Set<string>(INTERACTIVE_FILM_STATUSES);

export function parseInteractiveFilmGameId(input: unknown): string {
  const parsed = ExperienceStableIdSchema.safeParse(input);
  if (!parsed.success) throw new Error("影游作品 ID 无效。");
  return parsed.data;
}

export function parseInteractiveFilmAdminAction(input: unknown): InteractiveFilmAdminAction {
  const value = objectValue(input, "审核动作");
  if (value.action === "approve" && hasOnlyKeys(value, ["action"])) {
    return { action: "approve" };
  }
  if (value.action === "offline" && hasOnlyKeys(value, ["action"])) {
    return { action: "offline" };
  }
  if (value.action === "reject" && hasOnlyKeys(value, ["action", "reason"])) {
    const reason = typeof value.reason === "string" ? value.reason.trim() : "";
    if (reason && [...reason].length <= 1_000) return { action: "reject", reason };
  }
  throw new Error("审核动作无效；驳回时必须填写 1-1000 字原因。");
}

export function isInteractiveFilmAdminActionAllowed(
  status: InteractiveFilmStatus,
  action: InteractiveFilmAdminAction["action"]
): boolean {
  return action === "offline"
    ? status === "reviewing" || status === "published"
    : status === "reviewing";
}

export function parseAdminInteractiveFilmList(input: unknown): AdminInteractiveFilmList {
  const value = objectValue(input, "影游审核列表");
  if (!Array.isArray(value.list)) throw invalidWireError("影游审核列表", "list");
  return {
    list: value.list.map((item) => normalizeSummary(objectValue(item, "影游作品"))),
    total: nonnegativeInteger(value.total, "total"),
    stats: parseStats(value.stats),
  };
}

export function parseAdminInteractiveFilmDetail(input: unknown): AdminInteractiveFilmDetail {
  const value = objectValue(input, "影游审核详情");
  return {
    ...normalizeSummary(value),
    creatorId: creatorId(value.creatorId),
    rejectReason: optionalString(value.rejectReason, "rejectReason"),
    draftManifestUrl: optionalSchemaString(value.draftManifestUrl, "draftManifestUrl", "url"),
    manifestUrl: optionalSchemaString(value.manifestUrl, "manifestUrl", "url"),
    createdAt: optionalSchemaString(value.createdAt, "createdAt", "timestamp"),
    publishedAt: optionalSchemaString(value.publishedAt, "publishedAt", "timestamp"),
    offlineAt: optionalSchemaString(value.offlineAt, "offlineAt", "timestamp"),
  };
}

/** The BFF returns the same fields as Java, normalised to explicit nulls. */
export const parseAdminInteractiveFilmBffDetail = parseAdminInteractiveFilmDetail;

function normalizeSummary(value: Record<string, unknown>): AdminInteractiveFilmSummary {
  return {
    gameId: parseInteractiveFilmGameId(value.gameId),
    title: requiredSchemaString(value.title, "title", "display"),
    subtitle: optionalSchemaString(value.subtitle, "subtitle", "display"),
    coverUrl: optionalSchemaString(value.coverUrl, "coverUrl", "url"),
    status: publicationStatus(value.status),
    draftVersion: optionalSchemaString(value.draftVersion, "draftVersion", "id"),
    currentVersion: optionalSchemaString(value.currentVersion, "currentVersion", "id"),
    updatedAt: optionalSchemaString(value.updatedAt, "updatedAt", "timestamp"),
  };
}

function parseStats(input: unknown): AdminInteractiveFilmStats {
  const value = objectValue(input, "影游审核统计");
  return {
    total: nonnegativeInteger(value.total, "stats.total"),
    draft: nonnegativeInteger(value.draft, "stats.draft"),
    reviewing: nonnegativeInteger(value.reviewing, "stats.reviewing"),
    published: nonnegativeInteger(value.published, "stats.published"),
    offline: nonnegativeInteger(value.offline, "stats.offline"),
  };
}

function publicationStatus(input: unknown): InteractiveFilmStatus {
  if (typeof input !== "string" || !STATUS_SET.has(input)) {
    throw invalidWireError("影游作品", "status");
  }
  return input as InteractiveFilmStatus;
}

function objectValue(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidWireError(label, "响应体");
  }
  return input as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => key in value);
}

function requiredSchemaString(
  input: unknown,
  field: string,
  schema: "display" | "id" | "url" | "timestamp"
): string {
  if (schema === "id") {
    const parsed = ExperienceStableIdSchema.safeParse(input);
    if (parsed.success) return parsed.data;
  } else if (typeof input === "string") {
    const value = input.trim();
    if (schema === "display" && value && [...value].length <= 240) return value;
    if (schema === "timestamp" && value && !Number.isNaN(Date.parse(value))) return value;
    if (schema === "url" && isHttpUrl(value)) return value;
  }
  throw invalidWireError("影游作品", field);
}

function optionalSchemaString(
  input: unknown,
  field: string,
  schema: "display" | "id" | "url" | "timestamp"
): string | null {
  return input == null ? null : requiredSchemaString(input, field, schema);
}

function optionalString(input: unknown, field: string): string | null {
  if (input == null) return null;
  if (typeof input !== "string") throw invalidWireError("影游作品", field);
  return input;
}

function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

function creatorId(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "string" && input) return input;
  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0) return String(input);
  throw invalidWireError("影游作品", "creatorId");
}

function nonnegativeInteger(input: unknown, field: string): number {
  if (typeof input === "number" && Number.isSafeInteger(input) && input >= 0) {
    return input;
  }
  if (typeof input === "string" && /^\d+$/.test(input)) {
    const value = Number(input);
    if (Number.isSafeInteger(value)) return value;
  }
  throw invalidWireError("影游审核列表", field);
}

function invalidWireError(label: string, field: string): Error {
  return new Error(`Java 返回的${label}不符合接口文档（${field}）。`);
}
