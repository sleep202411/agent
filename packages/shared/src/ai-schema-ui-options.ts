/**
 * Ensure every user-visible enum field carries `x-ui.options`.
 *
 * Catalog authors may only ship `enum`; product UI prefers explicit
 * `{ value, label, labelKey }` so labels/i18n stay out of hard-coded client
 * maps. Call this at the catalog boundary so every provider benefits without
 * per-mapper copy-paste.
 */

import type { AiJsonPrimitive, AiJsonSchema, AiObjectSchema, AiUiOption } from "./ai-schema.js";

const AUTO_VALUES = new Set(["auto", "adaptive"]);

export function aiUiOptionForValue(value: AiJsonPrimitive): AiUiOption {
  if (typeof value === "string" && AUTO_VALUES.has(value.toLowerCase())) {
    return { value, label: "Auto", labelKey: "sizePresets.auto" };
  }
  if (value === null) {
    return { value: "", label: "" };
  }
  return { value, label: String(value) };
}

export function aiUiOptionsFromEnum(values: readonly AiJsonPrimitive[] | undefined): AiUiOption[] {
  if (!values?.length) return [];
  return values.map(aiUiOptionForValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOptions(ui: unknown): boolean {
  if (!isRecord(ui)) return false;
  return Array.isArray(ui.options) && ui.options.length > 0;
}

/**
 * Deep-walk a JSON Schema object and attach `x-ui.options` for any property
 * that has a non-empty `enum` and an `x-ui` block without options yet.
 * Leaves fields without `x-ui` alone (not user-facing controls).
 */
export function attachUiOptionsToEnumFields(schema: AiObjectSchema): AiObjectSchema {
  return attachToSchemaNode(schema) as AiObjectSchema;
}

function attachToSchemaNode(schema: AiJsonSchema): AiJsonSchema {
  if (!schema || typeof schema !== "object") return schema;

  if (schema.type === "object" && schema.properties) {
    const properties: Record<string, AiJsonSchema> = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      properties[key] = attachToSchemaNode(prop);
    }
    return {
      ...schema,
      properties,
      ...(schema.type === "object" && "x-rules" in schema ? { "x-rules": schema["x-rules"] } : {}),
    };
  }

  if (schema.type === "array" && schema.items) {
    return {
      ...schema,
      items: attachToSchemaNode(schema.items),
    };
  }

  const enums = schema.enum;
  if (!enums?.length) return schema;

  const ui = schema["x-ui"];
  // Only decorate field-level UI (not root group schema objects).
  if (!isRecord(ui) || hasOptions(ui)) return schema;
  // Group schemas use groups[]; skip those.
  if (Array.isArray(ui.groups)) return schema;

  return {
    ...schema,
    "x-ui": {
      ...ui,
      options: aiUiOptionsFromEnum(enums),
    },
  } as AiJsonSchema;
}

/**
 * Attach options onto a model definition's `input_schema` in place-safe style
 * (returns a shallow-cloned model with a new input_schema).
 */
export function withAttachedUiOptions<T extends { input_schema?: AiObjectSchema | null }>(
  model: T
): T {
  if (!model.input_schema) return model;
  return {
    ...model,
    input_schema: attachUiOptionsToEnumFields(model.input_schema),
  };
}
