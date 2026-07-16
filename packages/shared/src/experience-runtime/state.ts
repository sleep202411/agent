import { z } from "zod";
import {
  ExperienceJsonValueSchema,
  ExperienceStatePathSchema,
  ExperienceValueExpressionSchema,
  type ExperienceJsonValue,
} from "./common.js";

export const ExperienceStateValueTypeSchema = z.enum(["string", "number", "boolean", "json"]);
export type ExperienceStateValueType = z.infer<typeof ExperienceStateValueTypeSchema>;
export const ExperienceStateScopeSchema = z.enum(["session", "player", "scene"]);
export type ExperienceStateScope = z.infer<typeof ExperienceStateScopeSchema>;

const StateConstraintsSchema = z
  .object({
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    allowedValues: z.array(ExperienceJsonValueSchema).min(1).optional(),
  })
  .strict();

function valueMatchesType(
  value: ExperienceJsonValue,
  valueType: ExperienceStateValueType
): boolean {
  if (valueType === "json") {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  return typeof value === valueType;
}

function jsonValuesEqual(left: ExperienceJsonValue, right: ExperienceJsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => jsonValuesEqual(entry, right[index] as ExperienceJsonValue))
    );
  }
  if (
    typeof left === "object" &&
    left !== null &&
    !Array.isArray(left) &&
    typeof right === "object" &&
    right !== null &&
    !Array.isArray(right)
  ) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          jsonValuesEqual(left[key] as ExperienceJsonValue, right[key] as ExperienceJsonValue)
      )
    );
  }
  return false;
}

export const ExperienceStateDefinitionSchema = z
  .object({
    key: ExperienceStatePathSchema,
    valueType: ExperienceStateValueTypeSchema,
    scope: ExperienceStateScopeSchema,
    initialValue: ExperienceJsonValueSchema,
    constraints: StateConstraintsSchema.optional(),
    sensitive: z.boolean().default(false),
  })
  .strict()
  .superRefine((definition, context) => {
    if (!valueMatchesType(definition.initialValue, definition.valueType)) {
      context.addIssue({
        code: "custom",
        path: ["initialValue"],
        message: `Initial value must match ${definition.valueType}`,
      });
    }
    const constraints = definition.constraints;
    if (!constraints) return;
    if (
      (constraints.minimum !== undefined || constraints.maximum !== undefined) &&
      definition.valueType !== "number"
    ) {
      context.addIssue({
        code: "custom",
        path: ["constraints"],
        message: "Numeric bounds require a number state value",
      });
    }
    if (
      (constraints.minLength !== undefined || constraints.maxLength !== undefined) &&
      definition.valueType !== "string"
    ) {
      context.addIssue({
        code: "custom",
        path: ["constraints"],
        message: "Length bounds require a string state value",
      });
    }
    if (
      constraints.minimum !== undefined &&
      constraints.maximum !== undefined &&
      constraints.minimum > constraints.maximum
    ) {
      context.addIssue({
        code: "custom",
        path: ["constraints", "maximum"],
        message: "maximum must be greater than or equal to minimum",
      });
    }
    if (
      constraints.minLength !== undefined &&
      constraints.maxLength !== undefined &&
      constraints.minLength > constraints.maxLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["constraints", "maxLength"],
        message: "maxLength must be greater than or equal to minLength",
      });
    }
    constraints.allowedValues?.forEach((value, valueIndex) => {
      if (!valueMatchesType(value, definition.valueType)) {
        context.addIssue({
          code: "custom",
          path: ["constraints", "allowedValues", valueIndex],
          message: `Allowed value must match ${definition.valueType}`,
        });
      }
    });
    if (definition.valueType === "json" && constraints.allowedValues) {
      context.addIssue({
        code: "custom",
        path: ["constraints", "allowedValues"],
        message: "JSON object state cannot declare allowedValues",
      });
    }
    if (
      typeof definition.initialValue === "number" &&
      constraints.minimum !== undefined &&
      definition.initialValue < constraints.minimum
    ) {
      context.addIssue({
        code: "custom",
        path: ["initialValue"],
        message: `Initial value must be at least ${constraints.minimum}`,
      });
    }
    if (
      typeof definition.initialValue === "number" &&
      constraints.maximum !== undefined &&
      definition.initialValue > constraints.maximum
    ) {
      context.addIssue({
        code: "custom",
        path: ["initialValue"],
        message: `Initial value must be at most ${constraints.maximum}`,
      });
    }
    if (
      typeof definition.initialValue === "string" &&
      constraints.minLength !== undefined &&
      definition.initialValue.length < constraints.minLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["initialValue"],
        message: `Initial value must contain at least ${constraints.minLength} characters`,
      });
    }
    if (
      typeof definition.initialValue === "string" &&
      constraints.maxLength !== undefined &&
      definition.initialValue.length > constraints.maxLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["initialValue"],
        message: `Initial value must contain at most ${constraints.maxLength} characters`,
      });
    }
    if (
      constraints.allowedValues &&
      !constraints.allowedValues.some((allowed) =>
        jsonValuesEqual(allowed, definition.initialValue)
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["initialValue"],
        message: "Initial value must be included in allowedValues",
      });
    }
  });
export type ExperienceStateDefinition = z.infer<typeof ExperienceStateDefinitionSchema>;

export const ExperienceComparisonOperatorSchema = z.enum([
  "equals",
  "not-equals",
  "greater-than",
  "at-least",
  "less-than",
  "at-most",
  "contains",
]);

export type ExperienceCondition =
  | {
      kind: "compare";
      left: z.infer<typeof ExperienceValueExpressionSchema>;
      operator: z.infer<typeof ExperienceComparisonOperatorSchema>;
      right: z.infer<typeof ExperienceValueExpressionSchema>;
    }
  | { kind: "exists"; value: z.infer<typeof ExperienceValueExpressionSchema> }
  | { kind: "all"; conditions: ExperienceCondition[] }
  | { kind: "any"; conditions: ExperienceCondition[] }
  | { kind: "not"; condition: ExperienceCondition };

export const ExperienceConditionSchema: z.ZodType<ExperienceCondition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("compare"),
        left: ExperienceValueExpressionSchema,
        operator: ExperienceComparisonOperatorSchema,
        right: ExperienceValueExpressionSchema,
      })
      .strict(),
    z.object({ kind: z.literal("exists"), value: ExperienceValueExpressionSchema }).strict(),
    z
      .object({ kind: z.literal("all"), conditions: z.array(ExperienceConditionSchema).min(1) })
      .strict(),
    z
      .object({ kind: z.literal("any"), conditions: z.array(ExperienceConditionSchema).min(1) })
      .strict(),
    z.object({ kind: z.literal("not"), condition: ExperienceConditionSchema }).strict(),
  ])
);

export const ExperienceStateSnapshotSchema = z.record(
  ExperienceStatePathSchema,
  ExperienceJsonValueSchema
);
export type ExperienceStateSnapshot = z.infer<typeof ExperienceStateSnapshotSchema>;

/**
 * Runtime and persistence state is separated by lifecycle. Scene values reset
 * on every scene transition; session values live for one play session; player
 * values can be merged by the Java player-data service across sessions.
 */
export const ExperienceScopedStateSnapshotSchema = z
  .object({
    session: ExperienceStateSnapshotSchema,
    player: ExperienceStateSnapshotSchema,
    scene: ExperienceStateSnapshotSchema,
  })
  .strict();
export type ExperienceScopedStateSnapshot = z.infer<typeof ExperienceScopedStateSnapshotSchema>;
