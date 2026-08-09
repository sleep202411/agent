/**
 * Production generation preflight validation — catalog-driven, isomorphic.
 *
 * Rules live in the model catalog (`input_schema` field constraints / `x-ui`
 * metadata). This kernel only *evaluates* them. Adding a new model condition
 * (e.g. Seedance combined reference duration ≤ 15s) is a catalog data change:
 * studio and server both call the same pure function and never grow per-model
 * if-branches.
 *
 * Layering:
 *   catalog schema  →  validateGenerationInput()  →  ValidationIssue[]
 *                          ↑ studio pre-submit (Alert)
 *                          ↑ server pre-enqueue (400)
 */

export type ValidationSeverity = "error" | "warning";

/** Stable machine codes — UI may i18n via `code` + `params`; server returns `message`. */
export const VALIDATION_ISSUE_CODES = {
  FIELD_MAX_ITEMS: "FIELD_MAX_ITEMS",
  FIELD_MIN_ITEMS: "FIELD_MIN_ITEMS",
  MEDIA_DURATION_UNKNOWN: "MEDIA_DURATION_UNKNOWN",
  MEDIA_DURATION_SUM_BELOW_MIN: "MEDIA_DURATION_SUM_BELOW_MIN",
  MEDIA_DURATION_SUM_EXCEEDED: "MEDIA_DURATION_SUM_EXCEEDED",
  MEDIA_MAX_TOTAL_FILES: "MEDIA_MAX_TOTAL_FILES",
  MEDIA_AUDIO_REQUIRES_VISUAL: "MEDIA_AUDIO_REQUIRES_VISUAL",
  MEDIA_COMBINED_FILE_SIZE_EXCEEDED: "MEDIA_COMBINED_FILE_SIZE_EXCEEDED",
  MEDIA_FILE_SIZE_EXCEEDED: "MEDIA_FILE_SIZE_EXCEEDED",
} as const;

export type ValidationIssueCode =
  (typeof VALIDATION_ISSUE_CODES)[keyof typeof VALIDATION_ISSUE_CODES];

export interface ValidationIssue {
  code: ValidationIssueCode | string;
  severity: ValidationSeverity;
  /** Schema field the issue is about, when applicable. */
  field?: string;
  /** English default message (safe to surface). Prefer i18n via code+params on clients. */
  message: string;
  params?: Record<string, string | number | boolean>;
}

export type MediaRefKind = "image" | "video" | "audio";

/**
 * One media reference presented to the kernel. Callers (studio / server)
 * enrich duration / bytes before validation — the kernel does no I/O.
 *
 * When a duration rule applies to a video/audio field and any item lacks a
 * finite `durationSeconds`, validation hard-fails with
 * `MEDIA_DURATION_UNKNOWN` (never silent skip).
 */
export interface MediaRefSnapshot {
  field: string;
  kind: MediaRefKind;
  url?: string;
  assetId?: string;
  /** Exact seconds when known. Required for duration rules on video/audio. */
  durationSeconds?: number | null;
  bytes?: number | null;
}

/** Minimal schema surface the kernel reads — matches catalog `input_schema`. */
export interface ValidationSchemaProperty {
  type?: string;
  minItems?: number;
  maxItems?: number;
  "x-ui"?: {
    control?: string;
    group?: string;
    mediaKind?: MediaRefKind;
    maxFileSizeMb?: number;
    maxCombinedFileSizeMb?: number;
    minCombinedDurationSeconds?: number;
    maxCombinedDurationSeconds?: number;
    audioRequiresVisual?: boolean;
    maxTotalFiles?: number;
  };
}

export interface ValidationInputSchema {
  type?: string;
  properties?: Record<string, ValidationSchemaProperty>;
  required?: string[];
}

export interface ValidateGenerationInputArgs {
  inputSchema: ValidationInputSchema;
  /**
   * Normalized (or client-built) generation input. Reference fields may be
   * arrays of URL strings or `{ url, durationSeconds?, ... }` objects.
   */
  input: Record<string, unknown>;
  /**
   * Preferred media metadata source. When omitted, the kernel extracts what it
   * can from `input` reference fields (duration/bytes on object items).
   */
  media?: readonly MediaRefSnapshot[];
}

interface ReferenceFieldRule {
  field: string;
  kind: MediaRefKind;
  minItems?: number;
  maxItems?: number;
  maxFileSizeMb?: number;
  maxCombinedFileSizeMb?: number;
  minCombinedDurationSeconds?: number;
  maxCombinedDurationSeconds?: number;
  audioRequiresVisual: boolean;
  maxTotalFiles?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mediaKindFromUi(
  ui: ValidationSchemaProperty["x-ui"] | undefined,
  field: string
): MediaRefKind {
  if (ui?.mediaKind === "video" || ui?.mediaKind === "audio" || ui?.mediaKind === "image") {
    return ui.mediaKind;
  }
  if (ui?.control === "video_upload") return "video";
  if (ui?.control === "audio_upload") return "audio";
  if (/video/i.test(field)) return "video";
  if (/audio/i.test(field)) return "audio";
  return "image";
}

function isUploadField(name: string, prop: ValidationSchemaProperty): boolean {
  const ui = prop["x-ui"];
  return (
    ui?.control === "image_upload" ||
    ui?.control === "video_upload" ||
    ui?.control === "audio_upload" ||
    ui?.group === "references" ||
    /frame|reference|mask/i.test(name)
  );
}

/** Derive per-field media rules from catalog schema — no hard-coded model ids. */
export function deriveReferenceFieldRules(
  inputSchema: ValidationInputSchema
): ReferenceFieldRule[] {
  const properties = inputSchema.properties ?? {};
  const rules: ReferenceFieldRule[] = [];
  for (const [field, prop] of Object.entries(properties)) {
    if (!isUploadField(field, prop)) continue;
    const ui = prop["x-ui"];
    const kind = mediaKindFromUi(ui, field);
    const maxItems =
      prop.type === "array"
        ? typeof prop.maxItems === "number" && prop.maxItems > 0
          ? Math.floor(prop.maxItems)
          : undefined
        : 1;
    const minItems =
      prop.type === "array" && typeof prop.minItems === "number" && prop.minItems > 0
        ? Math.floor(prop.minItems)
        : undefined;
    rules.push({
      field,
      kind,
      minItems,
      maxItems,
      maxFileSizeMb:
        typeof ui?.maxFileSizeMb === "number" && Number.isFinite(ui.maxFileSizeMb)
          ? ui.maxFileSizeMb
          : undefined,
      maxCombinedFileSizeMb:
        typeof ui?.maxCombinedFileSizeMb === "number" && Number.isFinite(ui.maxCombinedFileSizeMb)
          ? ui.maxCombinedFileSizeMb
          : undefined,
      minCombinedDurationSeconds:
        typeof ui?.minCombinedDurationSeconds === "number" &&
        Number.isFinite(ui.minCombinedDurationSeconds)
          ? ui.minCombinedDurationSeconds
          : undefined,
      maxCombinedDurationSeconds:
        typeof ui?.maxCombinedDurationSeconds === "number" &&
        Number.isFinite(ui.maxCombinedDurationSeconds)
          ? ui.maxCombinedDurationSeconds
          : undefined,
      audioRequiresVisual: ui?.audioRequiresVisual === true,
      maxTotalFiles:
        typeof ui?.maxTotalFiles === "number" && Number.isFinite(ui.maxTotalFiles)
          ? ui.maxTotalFiles
          : undefined,
    });
  }
  return rules;
}

function finiteNonNegative(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function snapshotsFromInputItem(
  field: string,
  kind: MediaRefKind,
  item: unknown
): MediaRefSnapshot | null {
  if (typeof item === "string") {
    const url = item.trim();
    if (!url) return null;
    return { field, kind, url };
  }
  if (!isRecord(item)) return null;
  const url = typeof item.url === "string" ? item.url.trim() : undefined;
  const assetId = typeof item.assetId === "string" ? item.assetId : undefined;
  if (!url && !assetId) return null;
  return {
    field,
    kind,
    url,
    assetId,
    durationSeconds: finiteNonNegative(item.durationSeconds),
    bytes: finiteNonNegative(item.bytes) ?? finiteNonNegative(item.sizeBytes),
  };
}

/**
 * Collect media snapshots for reference fields. Explicit `media` wins per
 * (field, url/assetId); remaining items are pulled from `input`.
 */
export function collectMediaSnapshots(
  inputSchema: ValidationInputSchema,
  input: Record<string, unknown>,
  media?: readonly MediaRefSnapshot[]
): MediaRefSnapshot[] {
  const rules = deriveReferenceFieldRules(inputSchema);
  const explicit = media ?? [];
  const collected: MediaRefSnapshot[] = [];

  for (const rule of rules) {
    const raw = input[rule.field];
    const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    for (const item of items) {
      const fromInput = snapshotsFromInputItem(rule.field, rule.kind, item);
      if (!fromInput) continue;
      const match = explicit.find(
        (row) =>
          row.field === rule.field &&
          ((fromInput.assetId && row.assetId === fromInput.assetId) ||
            (fromInput.url && row.url === fromInput.url))
      );
      collected.push({
        ...fromInput,
        kind: match?.kind ?? fromInput.kind,
        durationSeconds:
          finiteNonNegative(match?.durationSeconds) ?? fromInput.durationSeconds ?? null,
        bytes: finiteNonNegative(match?.bytes) ?? fromInput.bytes ?? null,
      });
    }
  }

  // Include explicit media rows for fields present in schema but missing from
  // input (callers that only pass media[]).
  for (const row of explicit) {
    if (!rules.some((rule) => rule.field === row.field)) continue;
    const already = collected.some(
      (c) =>
        c.field === row.field &&
        ((row.assetId && c.assetId === row.assetId) || (row.url && c.url === row.url))
    );
    if (!already) {
      collected.push({
        ...row,
        durationSeconds: finiteNonNegative(row.durationSeconds),
        bytes: finiteNonNegative(row.bytes),
      });
    }
  }

  return collected;
}

function formatSeconds(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "");
}

/**
 * Pure catalog-driven validation. Safe to call from browser and Node.
 * Returns all issues (does not throw); callers decide blocking vs soft UX.
 */
export function validateGenerationInput(args: ValidateGenerationInputArgs): ValidationIssue[] {
  const rules = deriveReferenceFieldRules(args.inputSchema);
  if (rules.length === 0) return [];

  const media = collectMediaSnapshots(args.inputSchema, args.input, args.media);
  const issues: ValidationIssue[] = [];
  const byField = new Map<string, MediaRefSnapshot[]>();
  for (const row of media) {
    const list = byField.get(row.field) ?? [];
    list.push(row);
    byField.set(row.field, list);
  }

  let maxTotalFiles: number | undefined;
  let totalFiles = 0;
  let hasVisual = false;
  let hasAudio = false;
  let audioField: string | undefined;
  let audioRequiresVisual = false;

  for (const rule of rules) {
    // JSON Schema: absence is governed by `required` / x-rules, not minItems.
    // Only evaluate cardinality when the field is present on the input.
    const fieldPresent = Object.prototype.hasOwnProperty.call(args.input, rule.field);
    const rows = byField.get(rule.field) ?? [];
    totalFiles += rows.length;
    if (rule.kind === "image" || rule.kind === "video") {
      if (rows.length > 0) hasVisual = true;
    }
    if (rule.kind === "audio" && rows.length > 0) {
      hasAudio = true;
      audioField = rule.field;
    }
    if (rule.audioRequiresVisual) audioRequiresVisual = true;
    if (rule.maxTotalFiles != null) {
      maxTotalFiles =
        maxTotalFiles == null ? rule.maxTotalFiles : Math.min(maxTotalFiles, rule.maxTotalFiles);
    }

    if (fieldPresent && rule.maxItems != null && rows.length > rule.maxItems) {
      issues.push({
        code: VALIDATION_ISSUE_CODES.FIELD_MAX_ITEMS,
        severity: "error",
        field: rule.field,
        message: `${rule.field} accepts at most ${rule.maxItems} item(s).`,
        params: { field: rule.field, max: rule.maxItems, actual: rows.length },
      });
    }
    if (fieldPresent && rule.minItems != null && rows.length < rule.minItems) {
      issues.push({
        code: VALIDATION_ISSUE_CODES.FIELD_MIN_ITEMS,
        severity: "error",
        field: rule.field,
        message: `${rule.field} requires at least ${rule.minItems} item(s).`,
        params: { field: rule.field, min: rule.minItems, actual: rows.length },
      });
    }

    const needsDuration =
      rows.length > 0 &&
      (rule.kind === "video" || rule.kind === "audio") &&
      (rule.maxCombinedDurationSeconds != null || rule.minCombinedDurationSeconds != null);

    if (needsDuration) {
      const missing = rows.filter((row) => finiteNonNegative(row.durationSeconds) == null);
      if (missing.length > 0) {
        issues.push({
          code: VALIDATION_ISSUE_CODES.MEDIA_DURATION_UNKNOWN,
          severity: "error",
          field: rule.field,
          message: `Duration is required for every ${rule.kind} in ${rule.field} before submit.`,
          params: { field: rule.field, kind: rule.kind, missing: missing.length },
        });
      } else {
        const sum = rows.reduce(
          (acc, row) => acc + (finiteNonNegative(row.durationSeconds) ?? 0),
          0
        );
        if (rule.maxCombinedDurationSeconds != null && sum > rule.maxCombinedDurationSeconds) {
          issues.push({
            code: VALIDATION_ISSUE_CODES.MEDIA_DURATION_SUM_EXCEEDED,
            severity: "error",
            field: rule.field,
            message: `Combined ${rule.kind} duration in ${rule.field} is ${formatSeconds(sum)}s; maximum is ${formatSeconds(rule.maxCombinedDurationSeconds)}s.`,
            params: {
              field: rule.field,
              kind: rule.kind,
              actual: sum,
              max: rule.maxCombinedDurationSeconds,
            },
          });
        }
        if (rule.minCombinedDurationSeconds != null && sum < rule.minCombinedDurationSeconds) {
          issues.push({
            code: VALIDATION_ISSUE_CODES.MEDIA_DURATION_SUM_BELOW_MIN,
            severity: "error",
            field: rule.field,
            message: `Combined ${rule.kind} duration in ${rule.field} is ${formatSeconds(sum)}s; minimum is ${formatSeconds(rule.minCombinedDurationSeconds)}s.`,
            params: {
              field: rule.field,
              kind: rule.kind,
              actual: sum,
              min: rule.minCombinedDurationSeconds,
            },
          });
        }
      }
    }

    // Size limits judge only what is actually known. Byte sizes are resolved
    // server-side from the MediaAsset row; an unknown size is not evidence of
    // an oversized file, so it must never block a submit. Oversized uploads are
    // caught at file-pick time by the composer, and again here once bytes are
    // known. Duration rules below still fail closed — those limits are the
    // provider's, and the server can always measure them.
    if (rule.maxFileSizeMb != null && rows.length > 0) {
      const limitBytes = rule.maxFileSizeMb * 1024 * 1024;
      for (const row of rows) {
        const bytes = finiteNonNegative(row.bytes);
        if (bytes == null) continue;
        if (bytes > limitBytes) {
          issues.push({
            code: VALIDATION_ISSUE_CODES.MEDIA_FILE_SIZE_EXCEEDED,
            severity: "error",
            field: rule.field,
            message: `A file in ${rule.field} exceeds the ${rule.maxFileSizeMb} MB limit.`,
            params: {
              field: rule.field,
              maxMb: rule.maxFileSizeMb,
              actualBytes: bytes,
            },
          });
        }
      }
    }

    // Same rule as above: a combined limit is only enforceable when every item's
    // size is known. Partial knowledge understates the sum, so we stay silent.
    if (rule.maxCombinedFileSizeMb != null && rows.length > 0) {
      const known = rows
        .map((row) => finiteNonNegative(row.bytes))
        .filter((b): b is number => b != null);
      if (known.length === rows.length) {
        const sum = known.reduce((a, b) => a + b, 0);
        const limitBytes = rule.maxCombinedFileSizeMb * 1024 * 1024;
        if (sum > limitBytes) {
          issues.push({
            code: VALIDATION_ISSUE_CODES.MEDIA_COMBINED_FILE_SIZE_EXCEEDED,
            severity: "error",
            field: rule.field,
            message: `Combined file size in ${rule.field} exceeds ${rule.maxCombinedFileSizeMb} MB.`,
            params: {
              field: rule.field,
              maxMb: rule.maxCombinedFileSizeMb,
              actualBytes: sum,
            },
          });
        }
      }
    }
  }

  if (maxTotalFiles != null && totalFiles > maxTotalFiles) {
    issues.push({
      code: VALIDATION_ISSUE_CODES.MEDIA_MAX_TOTAL_FILES,
      severity: "error",
      message: `At most ${maxTotalFiles} reference file(s) allowed; got ${totalFiles}.`,
      params: { max: maxTotalFiles, actual: totalFiles },
    });
  }

  if (audioRequiresVisual && hasAudio && !hasVisual) {
    issues.push({
      code: VALIDATION_ISSUE_CODES.MEDIA_AUDIO_REQUIRES_VISUAL,
      severity: "error",
      field: audioField,
      message: "Audio references require at least one image or video reference.",
      params: { field: audioField ?? "referenceAudios" },
    });
  }

  return issues;
}

export function hasBlockingValidationIssues(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

/** First blocking issue message — useful for toast / 400 `msg` fallbacks. */
export function firstBlockingValidationMessage(
  issues: readonly ValidationIssue[]
): string | undefined {
  return issues.find((issue) => issue.severity === "error")?.message;
}
