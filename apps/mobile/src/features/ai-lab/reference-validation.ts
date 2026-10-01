import {
  deriveReferenceFieldRules,
  collectMediaSnapshots,
  validateGenerationInput,
  type AiObjectSchema,
  type MediaRefSnapshot,
  type ValidationInputSchema,
  type ValidationSchemaProperty,
} from "@repo/shared";
import { imageReferences } from "./reference-contract";
import { fieldDescriptors } from "./schema";
// The catalog carries richer x-ui extensions than the shared presentation type.
// Preserve those runtime constraints while projecting the validation kernel's schema surface.
function validationSchema(schema: AiObjectSchema): ValidationInputSchema {
  return {
    type: schema.type,
    required: schema.required,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([name, field]) => [
        name,
        {
          type: field.type,
          ...(field.type === "array" ? { minItems: field.minItems, maxItems: field.maxItems } : {}),
          "x-ui": field["x-ui"] as ValidationSchemaProperty["x-ui"],
        },
      ])
    ),
  };
}
export function referenceValues(schema: AiObjectSchema, values: Record<string, unknown>) {
  const result = { ...values };
  const names = new Set(
    deriveReferenceFieldRules(validationSchema(schema)).map((rule) => rule.field)
  );
  for (const { name, field } of fieldDescriptors(schema, values)) {
    if (!names.has(name) || field.type !== "array" || typeof result[name] !== "string") continue;
    if (field.items.type === "object") result[name] = imageReferences(result[name]);
    else if (field.items.type === "string")
      result[name] = (result[name] as string)
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean);
  }
  return result;
}
export function validateReferenceMedia(
  schema: AiObjectSchema,
  input: Record<string, unknown>,
  media?: MediaRefSnapshot[],
  uploadingField?: string
) {
  const issues = validateGenerationInput({ inputSchema: validationSchema(schema), input, media });
  const error = issues.find(
    (issue) =>
      issue.severity === "error" &&
      (!uploadingField ||
        (![
          "FIELD_MIN_ITEMS",
          "MEDIA_DURATION_SUM_BELOW_MIN",
          "MEDIA_AUDIO_REQUIRES_VISUAL",
        ].includes(issue.code) &&
          (!issue.field ||
            issue.field === uploadingField ||
            issue.code === "MEDIA_MAX_TOTAL_FILES")))
  );
  if (error) throw new Error(error.message);
}
export function referenceSnapshots(
  schema: AiObjectSchema,
  values: Record<string, unknown>,
  media?: MediaRefSnapshot[]
) {
  return collectMediaSnapshots(validationSchema(schema), referenceValues(schema, values), media);
}
