import type { AiObjectSchema } from "@repo/shared";
import { pruneInput, validateInput, type AiValidationMessages } from "./schema";
/** Saved fields outside the provider's current contract require an explicit user decision. */
export function unsupportedFormFields(schema: AiObjectSchema, raw: Record<string, unknown>) {
  if (schema.additionalProperties === true) return [];
  return Object.keys(raw).filter(
    (name) =>
      !Object.prototype.hasOwnProperty.call(schema.properties, name) && raw[name] !== undefined
  );
}
/** Keep raw text in the draft, parse only for review/submission so typing is lossless. */
export function prepareFormValues(
  schema: AiObjectSchema,
  raw: Record<string, unknown>,
  messages?: AiValidationMessages
) {
  const unsupported = unsupportedFormFields(schema, raw);
  if (unsupported.length)
    throw new Error(
      messages?.unsupportedOption(unsupported[0]!) ?? `Unsupported saved setting: ${unsupported[0]}`
    );
  const values: Record<string, unknown> = { ...raw };
  for (const [name, field] of Object.entries(schema.properties)) {
    const value = raw[name];
    if (typeof value !== "string") continue;
    if (field.type === "number" || field.type === "integer") {
      if (!value.trim()) {
        values[name] = undefined;
        continue;
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || (field.type === "integer" && !Number.isInteger(parsed)))
        throw new Error(
          `${field.title ?? name}: ${messages?.unsupportedOption(field.title ?? name) ?? "Enter a valid number."}`
        );
      values[name] = parsed;
    } else if (field.type === "array") {
      values[name] =
        field.items.type === "string"
          ? value
              .split(/\r?\n/)
              .map((v) => v.trim())
              .filter(Boolean)
          : JSON.parse(value);
    } else if (field.type === "object") values[name] = JSON.parse(value);
  }
  const issues = validateInput(schema, values, messages);
  if (issues.length) throw new Error(issues[0].message);
  const extras =
    schema.additionalProperties === true
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([name]) => !Object.prototype.hasOwnProperty.call(schema.properties, name)
          )
        )
      : {};
  return { ...extras, ...pruneInput(schema, values) };
}
