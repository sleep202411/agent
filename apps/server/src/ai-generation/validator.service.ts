import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  FoundryConditionExpression,
  FoundryFieldConstraint,
  FoundryInputSchema,
  FoundryJsonSchemaProperty,
  FoundryObjectSchema,
  FoundrySchemaRule,
} from './types';

@Injectable()
export class AiGenerationValidatorService {
  normalizeInput(
    schema: FoundryInputSchema,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const normalized = this.normalizeObject(schema, input, 'Input');
    this.applyRules(schema['x-rules'] ?? [], normalized);
    return normalized;
  }

  private normalizeObject(
    schema: FoundryObjectSchema,
    input: Record<string, unknown>,
    title: string,
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    const required = new Set(schema.required ?? []);

    for (const [key, field] of Object.entries(schema.properties)) {
      const raw = input[key] ?? field.default;
      const empty = this.isEmpty(raw);
      const label = this.fieldTitle(field, key);

      if (required.has(key) && empty) {
        throw this.validationError(`${label} is required.`);
      }

      if (empty) continue;
      normalized[key] = this.normalizeField(key, field, raw);
    }

    if (schema.additionalProperties === true) {
      for (const [key, value] of Object.entries(input)) {
        if (!(key in schema.properties)) normalized[key] = value;
      }
    }

    return normalized;
  }

  private normalizeField(
    key: string,
    field: FoundryJsonSchemaProperty,
    raw: unknown,
  ): unknown {
    switch (field.type) {
      case 'string': {
        const value = String(raw).trim();
        const label = this.fieldTitle(field, key);
        if (field.minLength != null && value.length < field.minLength) {
          throw this.validationError(
            `${label} must be at least ${field.minLength} characters.`,
          );
        }
        if (field.maxLength != null && value.length > field.maxLength) {
          throw this.validationError(
            `${label} must be ${field.maxLength} characters or fewer.`,
          );
        }
        this.assertEnum(field, value, key);
        this.assertPattern(field, value, key);
        this.assertStringFormat(field, value, key);
        this.assertConstraints(field['x-constraints'] ?? [], value, key, field);
        return value;
      }
      case 'integer': {
        const value = Number(raw);
        if (!Number.isInteger(value)) {
          throw this.validationError(
            `${this.fieldTitle(field, key)} must be an integer.`,
          );
        }
        this.assertRange(field, value, key);
        this.assertEnum(field, value, key);
        return value;
      }
      case 'number': {
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          throw this.validationError(
            `${this.fieldTitle(field, key)} must be a number.`,
          );
        }
        this.assertRange(field, value, key);
        this.assertEnum(field, value, key);
        return value;
      }
      case 'boolean':
        return this.normalizeBoolean(field, raw, key);
      case 'array': {
        if (!Array.isArray(raw)) {
          throw this.validationError(
            `${this.fieldTitle(field, key)} must be a list.`,
          );
        }
        if (field.minItems != null && raw.length < field.minItems) {
          throw this.validationError(
            `${this.fieldTitle(field, key)} requires at least ${field.minItems} item(s).`,
          );
        }
        if (field.maxItems != null && raw.length > field.maxItems) {
          throw this.validationError(
            `${this.fieldTitle(field, key)} accepts at most ${field.maxItems} item(s).`,
          );
        }
        return raw.map((item, index) =>
          this.normalizeArrayItem(key, field.items, item, index),
        );
      }
      case 'object': {
        if (!this.isRecord(raw)) {
          throw this.validationError(
            `${this.fieldTitle(field, key)} must be an object.`,
          );
        }
        return this.normalizeObject(field, raw, this.fieldTitle(field, key));
      }
      default:
        return raw;
    }
  }

  private normalizeArrayItem(
    key: string,
    itemSchema: FoundryJsonSchemaProperty,
    item: unknown,
    index: number,
  ): unknown {
    if (itemSchema.type === 'object' && typeof item === 'string') {
      const url = item.trim();
      this.assertUri(url, `${key}[${index}]`);
      return this.normalizeObject(itemSchema, { url }, `${key}[${index}]`);
    }
    return this.normalizeField(`${key}[${index}]`, itemSchema, item);
  }

  private normalizeBoolean(
    field: FoundryJsonSchemaProperty,
    raw: unknown,
    key: string,
  ): boolean {
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw this.validationError(
      `${this.fieldTitle(field, key)} must be true or false.`,
    );
  }

  private applyRules(
    rules: FoundrySchemaRule[],
    normalized: Record<string, unknown>,
  ): void {
    for (const rule of rules) {
      if (!this.matchesCondition(rule.when, normalized)) continue;

      for (const field of rule.fields) {
        const value = normalized[field];
        const empty = this.isEmpty(value);

        if (rule.effect === 'forbid' && !empty) {
          throw this.validationError(rule.message);
        }
        if (rule.effect === 'require' && empty) {
          throw this.validationError(rule.message);
        }
        if (rule.effect === 'clear') {
          delete normalized[field];
        }
        if (rule.effect === 'setDefault' && empty) {
          normalized[field] = rule.value;
        }
      }
    }
  }

  private matchesCondition(
    condition: FoundryConditionExpression,
    input: Record<string, unknown>,
  ): boolean {
    if ('all' in condition && condition.all) {
      return condition.all.every((item) => this.matchesCondition(item, input));
    }
    if ('any' in condition && condition.any) {
      return condition.any.some((item) => this.matchesCondition(item, input));
    }
    if ('not' in condition && condition.not) {
      return !this.matchesCondition(condition.not, input);
    }
    if (!('field' in condition)) return false;

    const value = input[condition.field];
    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'notEquals':
        return value !== condition.value;
      case 'in':
        return Boolean(
          condition.values?.some((candidate) => candidate === value),
        );
      case 'notIn':
        return !condition.values?.some((candidate) => candidate === value);
      case 'exists':
        return !this.isEmpty(value);
      case 'empty':
        return this.isEmpty(value);
      case 'gt':
        return Number(value) > Number(condition.value);
      case 'gte':
        return Number(value) >= Number(condition.value);
      case 'lt':
        return Number(value) < Number(condition.value);
      case 'lte':
        return Number(value) <= Number(condition.value);
      default:
        return false;
    }
  }

  private assertEnum(
    field: FoundryJsonSchemaProperty,
    value: unknown,
    key: string,
  ): void {
    if (!field.enum?.length) return;
    if (!field.enum.includes(value as never)) {
      throw this.validationError(
        `${this.fieldTitle(field, key)} has an unsupported value.`,
      );
    }
  }

  private assertPattern(
    field: FoundryJsonSchemaProperty,
    value: string,
    key: string,
  ): void {
    if (field.type !== 'string' || !field.pattern) return;
    if (!new RegExp(field.pattern).test(value)) {
      throw this.validationError(
        `${this.fieldTitle(field, key)} has an invalid format.`,
      );
    }
  }

  private assertStringFormat(
    field: FoundryJsonSchemaProperty,
    value: string,
    key: string,
  ): void {
    if (field.type !== 'string') return;
    if (field.format === 'uri')
      this.assertUri(value, this.fieldTitle(field, key));
  }

  private assertRange(
    field: FoundryJsonSchemaProperty,
    value: number,
    key: string,
  ): void {
    const label = this.fieldTitle(field, key);
    if ('minimum' in field && field.minimum != null && value < field.minimum) {
      throw this.validationError(`${label} must be at least ${field.minimum}.`);
    }
    if ('maximum' in field && field.maximum != null && value > field.maximum) {
      throw this.validationError(`${label} must be at most ${field.maximum}.`);
    }
    if (
      'multipleOf' in field &&
      field.multipleOf != null &&
      value % field.multipleOf !== 0
    ) {
      throw this.validationError(
        `${label} must be a multiple of ${field.multipleOf}.`,
      );
    }
  }

  private assertConstraints(
    constraints: FoundryFieldConstraint[],
    value: unknown,
    key: string,
    field: FoundryJsonSchemaProperty,
  ): void {
    for (const constraint of constraints) {
      if (constraint.kind === 'dimension2d') {
        this.assertDimension2d(constraint, String(value), key, field);
      }
    }
  }

  private assertDimension2d(
    constraint: Extract<FoundryFieldConstraint, { kind: 'dimension2d' }>,
    value: string,
    key: string,
    field: FoundryJsonSchemaProperty,
  ): void {
    const label = this.fieldTitle(field, key);
    if (value === 'auto' && constraint.allowAuto) return;

    const match = /^([1-9]\d*)x([1-9]\d*)$/.exec(value);
    if (!match) {
      throw this.validationError(`${label} must be auto or WIDTHxHEIGHT.`);
    }

    const width = Number(match[1]);
    const height = Number(match[2]);
    const shortEdge = Math.min(width, height);
    const longEdge = Math.max(width, height);
    const pixels = width * height;

    if (
      constraint.multipleOf &&
      (width % constraint.multipleOf !== 0 ||
        height % constraint.multipleOf !== 0)
    ) {
      throw this.validationError(
        `${label} width and height must be multiples of ${constraint.multipleOf}.`,
      );
    }

    if (constraint.maxEdge && longEdge > constraint.maxEdge) {
      throw this.validationError(
        `${label} edges must be ${constraint.maxEdge}px or smaller.`,
      );
    }

    if (
      constraint.maxAspectRatio &&
      longEdge / shortEdge > constraint.maxAspectRatio
    ) {
      throw this.validationError(
        `${label} aspect ratio must not exceed ${constraint.maxAspectRatio}:1.`,
      );
    }

    if (constraint.minPixels && pixels < constraint.minPixels) {
      throw this.validationError(
        `${label} total pixels must be at least ${constraint.minPixels}.`,
      );
    }
    if (constraint.maxPixels && pixels > constraint.maxPixels) {
      throw this.validationError(
        `${label} total pixels must be at most ${constraint.maxPixels}.`,
      );
    }
  }

  private assertUri(value: string, label: string): void {
    try {
      new URL(value);
    } catch {
      throw this.validationError(`${label} contains an invalid URL.`);
    }
  }

  private fieldTitle(
    field: FoundryJsonSchemaProperty,
    fallback: string,
  ): string {
    return field.title ?? fallback;
  }

  private isEmpty(value: unknown): boolean {
    return (
      value == null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private validationError(message: string): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      msg: message,
    });
  }
}
