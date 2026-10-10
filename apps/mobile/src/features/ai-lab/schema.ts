// Adapted from official Web AI Lab schema rendering; Mobile owns its controls.
import type {
  AiCondition,
  AiConditionExpression,
  AiFieldUi,
  AiJsonPrimitive,
  AiJsonSchema,
  AiUiGroup,
  AiUiOption,
  AiUiSchema,
  AiJsonSchema as AiLabField,
  AiObjectSchema as AiLabSchema,
} from "@repo/shared";

export interface AiFieldDescriptor {
  name: string;
  field: AiLabField;
  ui: AiFieldUi;
  required: boolean;
  enabled: boolean;
  disabledReason?: string;
  groupId: string;
  order: number;
}

export interface AiFieldGroup {
  id: string;
  title: string;
  description?: string;
  collapsible: boolean;
  defaultCollapsed: boolean;
  fields: AiFieldDescriptor[];
}

export interface AiValidationIssue {
  field: string;
  message: string;
}

export interface AiValidationMessages {
  required: (label: string) => string;
  minLength: (label: string, min: number) => string;
  maxLength: (label: string, max: number) => string;
  minItems: (label: string, min: number) => string;
  maxItems: (label: string, max: number) => string;
  minimum: (label: string, min: number) => string;
  maximum: (label: string, max: number) => string;
  unsupportedOption: (label: string) => string;
  invalidUrl: (label: string) => string;
}

const DEFAULT_GROUP_ID = "parameters";
const defaultValidationMessages: AiValidationMessages = {
  required: (label) => `${label} is required.`,
  minLength: (label, min) => `${label} must be at least ${min} characters.`,
  maxLength: (label, max) => `${label} must be ${max} characters or fewer.`,
  minItems: (label, min) => `${label} must include at least ${min} item(s).`,
  maxItems: (label, max) => `${label} must include ${max} item(s) or fewer.`,
  minimum: (label, min) => `${label} must be at least ${min}.`,
  maximum: (label, max) => `${label} must be at most ${max}.`,
  unsupportedOption: (label) => `${label} is not a supported option.`,
  invalidUrl: (label) => `${label} must be a valid URL.`,
};

export function deriveInitialValues(schema: AiLabSchema): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const initial = defaultForField(field);
    if (initial !== undefined) values[name] = initial;
  }
  return values;
}

export function fieldDescriptors(
  schema: AiLabSchema,
  values: Record<string, unknown>
): AiFieldDescriptor[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {})
    .map(([name, field]) => {
      const ui = fieldUi(field);
      return {
        name,
        field,
        ui,
        required: required.has(name),
        enabled: evaluateOptional(ui.enabledWhen, values, true),
        disabledReason: ui.disabledReason,
        groupId: ui.group ?? (name === "prompt" ? "prompt" : DEFAULT_GROUP_ID),
        order: ui.order ?? 1_000,
      };
    })
    .filter((descriptor) => descriptor.ui.control !== "hidden")
    .filter((descriptor) => evaluateOptional(descriptor.ui.visibleWhen, values, true))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function groupFields(schema: AiLabSchema, fields: AiFieldDescriptor[]): AiFieldGroup[] {
  const uiSchema = schemaUi(schema);
  const configuredGroups = uiSchema?.groups ?? [];
  const byId = new Map<string, AiUiGroup>();
  for (const group of configuredGroups) byId.set(group.id, group);

  const fieldGroupIds = [...new Set(fields.map((field) => field.groupId))];
  return fieldGroupIds
    .map((id) => {
      const configured = byId.get(id);
      return {
        id,
        title: configured?.title ?? defaultGroupTitle(id),
        description: configured?.description,
        collapsible: configured?.collapsible ?? id !== "prompt",
        defaultCollapsed: configured?.defaultCollapsed ?? id !== "prompt",
        order: configured?.order ?? (id === "prompt" ? 0 : 1_000),
        fields: fields.filter((field) => field.groupId === id),
      };
    })
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((group) => ({
      id: group.id,
      title: group.title,
      description: group.description,
      collapsible: group.collapsible,
      defaultCollapsed: group.defaultCollapsed,
      fields: group.fields,
    }));
}

export function primaryFields(fields: AiFieldDescriptor[]): AiFieldDescriptor[] {
  return fields.filter((field) => field.ui.importance === "primary" && field.name !== "prompt");
}

export function secondaryFields(fields: AiFieldDescriptor[]): AiFieldDescriptor[] {
  return fields.filter((field) => field.ui.importance !== "primary" || field.name === "prompt");
}

export function readOptions(field: AiLabField): AiUiOption[] {
  const uiOptions = fieldUi(field).options;
  if (Array.isArray(uiOptions) && uiOptions.length > 0) return uiOptions;
  if ("enum" in field && Array.isArray(field.enum)) {
    return field.enum
      .filter((value): value is string | number | boolean => value !== null)
      .map((value) => ({ value, label: String(value) }));
  }
  return [];
}

export function fieldLabel(field: AiLabField, fallback: string): string {
  return field.title ?? fieldUi(field).label ?? humanize(fallback);
}

export function fieldDescription(field: AiLabField): string | undefined {
  return field.description ?? fieldUi(field).hint;
}

export function normalizeFieldValue(field: AiLabField, raw: string | boolean): unknown {
  if (field.type === "boolean") return Boolean(raw);
  if (field.type === "integer") {
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (field.type === "number") {
    const parsed = Number.parseFloat(String(raw));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (field.type === "array") {
    return String(raw)
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return raw;
}

export function serializeFieldValue(field: AiLabField, value: unknown): string {
  if (field.type === "array") {
    return Array.isArray(value)
      ? field.items.type === "string"
        ? value.map(String).join("\n")
        : JSON.stringify(value)
      : "";
  }
  if (value === null || value === undefined) return "";
  return String(value);
}

export function validateInput(
  schema: AiLabSchema,
  values: Record<string, unknown>,
  messages: AiValidationMessages = defaultValidationMessages
): AiValidationIssue[] {
  const issues: AiValidationIssue[] = [];
  const required = new Set(schema.required ?? []);
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    if (fieldUi(field).control === "hidden") continue;
    if (required.has(name) && isEmptyValue(values[name])) {
      issues.push({ field: name, message: messages.required(fieldLabel(field, name)) });
      continue;
    }
    const value = values[name];
    if (isEmptyValue(value)) continue;
    issues.push(...validateField(name, field, value, messages));
  }

  for (const rule of schema["x-rules"] ?? []) {
    if (!evaluateCondition(rule.when, values)) continue;
    for (const fieldName of rule.fields) {
      const value = values[fieldName];
      if (rule.effect === "forbid" && !isEmptyValue(value)) {
        issues.push({ field: fieldName, message: rule.message });
      }
      if (rule.effect === "require" && isEmptyValue(value)) {
        issues.push({ field: fieldName, message: rule.message });
      }
    }
  }

  return issues;
}

export function pruneInput(
  schema: AiLabSchema,
  values: Record<string, unknown>
): Record<string, unknown> {
  const required = new Set(schema.required ?? []);
  const input: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const value = values[name];
    if (!required.has(name) && isEmptyValue(value)) continue;
    if (field.type === "array" && Array.isArray(value)) {
      input[name] = value.filter((item) => !isEmptyValue(item));
      continue;
    }
    input[name] = value;
  }
  return input;
}

export function optionLocked(
  option: AiUiOption,
  currentPlanRank: number,
  planRank: (plan: string | null | undefined) => number
): boolean {
  return option.requiredPlan != null && planRank(option.requiredPlan) > currentPlanRank;
}

export function evaluateOptional(
  expression: AiConditionExpression | undefined,
  values: Record<string, unknown>,
  fallback: boolean
): boolean {
  return expression ? evaluateCondition(expression, values) : fallback;
}

function schemaUi(schema: AiLabSchema): AiUiSchema | undefined {
  const ui = schema["x-ui"];
  if (!ui || typeof ui !== "object") return undefined;
  return "groups" in ui && Array.isArray(ui.groups) ? ui : undefined;
}

export function fieldUi(field: AiLabField): AiFieldUi {
  const ui = field["x-ui"];
  if (!ui || typeof ui !== "object" || "groups" in ui) return {};
  return ui;
}

function defaultForField(field: AiJsonSchema): unknown {
  if ("default" in field && field.default !== undefined) return field.default;
  if ("const" in field && field.const !== undefined) return field.const;
  if ("enum" in field && Array.isArray(field.enum) && field.enum.length > 0) {
    return field.enum[0];
  }
  if (field.type === "boolean") return false;
  if (field.type === "array") return [];
  if (field.type === "integer" || field.type === "number") {
    if (typeof field.minimum === "number") return field.minimum;
    return undefined;
  }
  if (field.type === "object") return {};
  return "";
}

function validateField(
  name: string,
  field: AiLabField,
  value: unknown,
  messages: AiValidationMessages
): AiValidationIssue[] {
  const issues: AiValidationIssue[] = [];
  const label = fieldLabel(field, name);
  const validType =
    field.type === "array"
      ? Array.isArray(value)
      : field.type === "object"
        ? !!value && typeof value === "object" && !Array.isArray(value)
        : field.type === "integer"
          ? typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)
          : field.type === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : typeof value === field.type;
  if (!validType) return [{ field: name, message: messages.unsupportedOption(label) }];
  if ("const" in field && field.const !== undefined && value !== field.const)
    issues.push({ field: name, message: messages.unsupportedOption(label) });
  if (field.type === "array" && Array.isArray(value))
    value.forEach((item, index) =>
      issues.push(...validateField(`${name}[${index}]`, field.items, item, messages))
    );
  if (field.type === "object" && value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    issues.push(...validateInput(field, record, messages));
    if (
      field.additionalProperties === false &&
      Object.keys(record).some((key) => !(key in field.properties))
    )
      issues.push({ field: name, message: messages.unsupportedOption(label) });
  }
  if (field.type === "string") {
    const text = String(value);
    if (typeof field.minLength === "number" && text.length < field.minLength) {
      issues.push({ field: name, message: messages.minLength(label, field.minLength) });
    }
    if (typeof field.maxLength === "number" && text.length > field.maxLength) {
      issues.push({ field: name, message: messages.maxLength(label, field.maxLength) });
    }
    if (field.format === "uri" && !isValidUrl(text)) {
      issues.push({ field: name, message: messages.invalidUrl(label) });
    }
  }
  if (field.type === "array") {
    const items = Array.isArray(value) ? value : [];
    if (typeof field.minItems === "number" && items.length < field.minItems) {
      issues.push({ field: name, message: messages.minItems(label, field.minItems) });
    }
    if (typeof field.maxItems === "number" && items.length > field.maxItems) {
      issues.push({ field: name, message: messages.maxItems(label, field.maxItems) });
    }
    if (field.items.type === "string" && field.items.format === "uri") {
      for (const item of items) {
        if (typeof item === "string" && !isValidUrl(item)) {
          issues.push({ field: name, message: messages.invalidUrl(label) });
          break;
        }
      }
    }
  }
  if ((field.type === "number" || field.type === "integer") && typeof value === "number") {
    if (typeof field.minimum === "number" && value < field.minimum) {
      issues.push({
        field: name,
        message: messages.minimum(label, field.minimum),
      });
    }
    if (typeof field.maximum === "number" && value > field.maximum) {
      issues.push({
        field: name,
        message: messages.maximum(label, field.maximum),
      });
    }
  }
  if (
    "enum" in field &&
    Array.isArray(field.enum) &&
    !field.enum.includes(value as AiJsonPrimitive)
  ) {
    issues.push({
      field: name,
      message: messages.unsupportedOption(label),
    });
  }
  return issues;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function evaluateCondition(
  expression: AiConditionExpression,
  values: Record<string, unknown>
): boolean {
  if ("all" in expression && Array.isArray(expression.all)) {
    return expression.all.every((item) => evaluateCondition(item, values));
  }
  if ("any" in expression && Array.isArray(expression.any)) {
    return expression.any.some((item) => evaluateCondition(item, values));
  }
  if ("not" in expression && expression.not) {
    return !evaluateCondition(expression.not, values);
  }
  return evaluateSimpleCondition(expression as AiCondition, values);
}

function evaluateSimpleCondition(condition: AiCondition, values: Record<string, unknown>): boolean {
  const value = values[condition.field];
  switch (condition.operator) {
    case "equals":
      return value === condition.value;
    case "notEquals":
      return value !== condition.value;
    case "in":
      return Array.isArray(condition.values) && condition.values.includes(value as AiJsonPrimitive);
    case "notIn":
      return (
        !Array.isArray(condition.values) || !condition.values.includes(value as AiJsonPrimitive)
      );
    case "exists":
      return !isEmptyValue(value);
    case "empty":
      return isEmptyValue(value);
    case "gt":
      return Number(value) > Number(condition.value);
    case "gte":
      return Number(value) >= Number(condition.value);
    case "lt":
      return Number(value) < Number(condition.value);
    case "lte":
      return Number(value) <= Number(condition.value);
    default:
      return true;
  }
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function defaultGroupTitle(id: string): string {
  if (id === "prompt") return "Prompt";
  if (id === "generation") return "Generation";
  if (id === "references") return "References";
  if (id === "output") return "Output";
  if (id === "advanced") return "Advanced";
  return humanize(id);
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
