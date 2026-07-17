import { z } from "zod";

export const EXPERIENCE_RUNTIME_SCHEMA_VERSION = 2 as const;
export const EXPERIENCE_PLAYER_PROTOCOL_VERSION = 1 as const;
export const EXPERIENCE_SEMANTIC_RULES_VERSION = 1 as const;

const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export const ExperienceStableIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
    "IDs may contain letters, numbers, dots, underscores, colons, slashes, and hyphens"
  );

export const ExperienceStatePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/,
    "State paths must be dot-separated identifiers"
  )
  .superRefine((path, context) => {
    path.split(".").forEach((segment, index) => {
      if (!FORBIDDEN_PATH_SEGMENTS.has(segment)) return;
      context.addIssue({
        code: "custom",
        message: `State path segment ${index + 1} is reserved`,
      });
    });
  });

export const ExperienceLocaleSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "Locales must be valid BCP 47 tags");

export const ExperienceLocalizedTextSchema = z.record(
  ExperienceLocaleSchema,
  z.string().trim().min(1)
);
export type ExperienceLocalizedText = z.infer<typeof ExperienceLocalizedTextSchema>;

export type ExperienceJsonValue =
  | string
  | number
  | boolean
  | null
  | ExperienceJsonValue[]
  | { [key: string]: ExperienceJsonValue };

export const ExperienceJsonValueSchema: z.ZodType<ExperienceJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(ExperienceJsonValueSchema),
    z.record(z.string(), ExperienceJsonValueSchema),
  ])
);

export const ExperienceJsonObjectSchema = z.record(z.string(), ExperienceJsonValueSchema);
export type ExperienceJsonObject = z.infer<typeof ExperienceJsonObjectSchema>;

export const ExperienceSha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Hashes must be lowercase SHA-256");

export const ExperienceRuntimeUriSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    if (value.startsWith("/") || value.startsWith("https://")) return;
    context.addIssue({
      code: "custom",
      message: "Runtime asset URIs must be root-relative or permanent HTTPS URLs",
    });
  });

export const ExperienceOrientationSchema = z.enum(["landscape", "portrait", "square"]);
export type ExperienceOrientation = z.infer<typeof ExperienceOrientationSchema>;

export const ExperienceNormalizedPointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

export const ExperienceNormalizedRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .superRefine((rect, context) => {
    if (rect.x + rect.width > 1) {
      context.addIssue({
        code: "custom",
        path: ["width"],
        message: "Normalized rectangles must remain inside the coordinate space width",
      });
    }
    if (rect.y + rect.height > 1) {
      context.addIssue({
        code: "custom",
        path: ["height"],
        message: "Normalized rectangles must remain inside the coordinate space height",
      });
    }
  });

export const ExperienceValueExpressionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: ExperienceJsonValueSchema }).strict(),
  z.object({ kind: z.literal("state"), path: ExperienceStatePathSchema }).strict(),
  z.object({ kind: z.literal("event"), path: ExperienceStatePathSchema }).strict(),
  z.object({ kind: z.literal("context"), path: ExperienceStatePathSchema }).strict(),
]);
export type ExperienceValueExpression = z.infer<typeof ExperienceValueExpressionSchema>;

export const ExperienceEventTypeSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(
    /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/,
    "Event types must be lower-case namespaced identifiers"
  );

export function uniqueById<T>(
  values: readonly T[],
  idFor: (value: T) => string,
  path: PropertyKey[],
  context: z.RefinementCtx
): Map<string, T> {
  const index = new Map<string, T>();
  values.forEach((value, valueIndex) => {
    const id = idFor(value);
    if (index.has(id)) {
      context.addIssue({
        code: "custom",
        path: [...path, valueIndex],
        message: `Duplicate id ${id}`,
      });
      return;
    }
    index.set(id, value);
  });
  return index;
}
