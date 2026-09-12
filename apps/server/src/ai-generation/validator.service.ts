import { BadRequestException, Injectable } from '@nestjs/common';
import {
  firstBlockingValidationMessage,
  hasBlockingValidationIssues,
  validateGenerationInput,
  type MediaRefSnapshot,
  type ValidationIssue,
} from '@repo/shared';
import {
  MediaAssetFactsService,
  type MediaAssetFacts,
} from '../media/media-asset-facts.service';
import type {
  AiConditionExpression,
  AiFieldConstraint,
  AiInputSchema,
  AiJsonSchemaProperty,
  AiObjectSchema,
  AiSchemaRule,
} from './types';

@Injectable()
export class AiGenerationValidatorService {
  constructor(private readonly mediaFacts: MediaAssetFactsService) {}

  /**
   * Overwrite client-claimed media facts with server-resolved ones.
   *
   * Every fact the MediaAsset row can answer for wins over whatever the client
   * sent — duration is measured, byte size is read off the row. What the server
   * cannot answer for is left alone on purpose: a reference without an
   * `assetId` (a wired canvas output, an external URL) has no durable row to
   * verify against, and the catalog duration rules fail closed, so discarding
   * the client's value there would reject a legitimate submit outright.
   */
  async applyTrustedMediaFacts(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const assetIds = new Set<string>();
    for (const value of Object.values(input)) {
      for (const item of this.asItemList(value)) {
        if (!this.isRecord(item)) continue;
        const assetId = item.assetId;
        if (typeof assetId !== 'string' || !assetId.trim()) continue;
        assetIds.add(assetId.trim());
      }
    }

    const factsById = assetIds.size
      ? await this.mediaFacts.ensureFacts([...assetIds])
      : new Map<string, MediaAssetFacts>();

    const next: Record<string, unknown> = { ...input };
    for (const [key, value] of Object.entries(input)) {
      if (Array.isArray(value)) {
        next[key] = value.map((item) => this.withTrustedFacts(item, factsById));
      } else if (this.isRecord(value)) {
        next[key] = this.withTrustedFacts(value, factsById);
      }
    }
    return next;
  }

  normalizeInput(
    schema: AiInputSchema,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const normalized = this.normalizeObject(schema, input);
    this.applyRules(schema['x-rules'] ?? [], normalized);
    // Catalog-driven media aggregate rules (duration sums, total files, …).
    // Same pure kernel as studio — no per-model branches on either side.
    this.assertCatalogMediaRules(schema, normalized);
    return normalized;
  }

  /**
   * Evaluate catalog `x-ui` media constraints against the normalized input.
   * Throws the first blocking issue as VALIDATION_ERROR (400).
   */
  assertCatalogMediaRules(
    schema: AiInputSchema,
    input: Record<string, unknown>,
    media?: readonly MediaRefSnapshot[],
  ): ValidationIssue[] {
    // Catalog schemas are a superset of the validation surface; cast keeps the
    // pure kernel decoupled from full object-schema nesting.
    const issues = validateGenerationInput({
      inputSchema: schema as Parameters<
        typeof validateGenerationInput
      >[0]['inputSchema'],
      input,
      media,
    });
    if (hasBlockingValidationIssues(issues)) {
      throw this.validationError(
        firstBlockingValidationMessage(issues) ??
          'Generation input failed catalog validation.',
        issues,
      );
    }
    return issues;
  }

  private withTrustedFacts(
    item: unknown,
    factsById: Map<string, MediaAssetFacts>,
  ): unknown {
    if (!this.isRecord(item)) return item;

    const assetId = typeof item.assetId === 'string' ? item.assetId.trim() : '';
    const facts = assetId ? factsById.get(assetId) : undefined;
    // Always overwrite this field, including when the asset is missing: a
    // client cannot supply its own billing evidence for metered references.
    const trusted: Record<string, unknown> = {
      ...item,
      referenceBillingFacts: facts ?? null,
    };
    if (!facts) return trusted;
    if (facts.durationSeconds != null) {
      trusted.durationSeconds = facts.durationSeconds;
    }
    if (facts.bytes != null) trusted.bytes = facts.bytes;
    return trusted;
  }

  private asItemList(value: unknown): unknown[] {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  private normalizeObject(
    schema: AiObjectSchema,
    input: Record<string, unknown>,
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
    field: AiJsonSchemaProperty,
    raw: unknown,
  ): unknown {
    switch (field.type) {
      case 'string': {
        const label = this.fieldTitle(field, key);
        // Only primitives may be coerced. `String({})` is "[object Object]" —
        // a bogus value that passes every downstream check and fails only at
        // the provider, after the call is paid for. Fail fast instead.
        if (
          typeof raw !== 'string' &&
          typeof raw !== 'number' &&
          typeof raw !== 'boolean'
        ) {
          throw this.validationError(`${label} must be a text value.`);
        }
        const value = String(raw).trim();
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
        // A bare URL string for a media {url} object field (e.g. an i2v
        // startFrame) is wrapped — mirrors the array-item path above, so
        // single-object reference fields accept the same shape array fields do.
        if (typeof raw === 'string' && field.properties?.url) {
          const url = raw.trim();
          this.assertUri(url, key);
          return this.normalizeObject(field, { url });
        }
        if (!this.isRecord(raw)) {
          throw this.validationError(
            `${this.fieldTitle(field, key)} must be an object.`,
          );
        }
        return this.normalizeObject(field, raw);
      }
      default:
        return raw;
    }
  }

  private normalizeArrayItem(
    key: string,
    itemSchema: AiJsonSchemaProperty,
    item: unknown,
    index: number,
  ): unknown {
    if (itemSchema.type === 'object' && typeof item === 'string') {
      const url = item.trim();
      this.assertUri(url, `${key}[${index}]`);
      return this.normalizeObject(itemSchema, { url });
    }
    return this.normalizeField(`${key}[${index}]`, itemSchema, item);
  }

  private normalizeBoolean(
    field: AiJsonSchemaProperty,
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
    rules: AiSchemaRule[],
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
    condition: AiConditionExpression,
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
    field: AiJsonSchemaProperty,
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
    field: AiJsonSchemaProperty,
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
    field: AiJsonSchemaProperty,
    value: string,
    key: string,
  ): void {
    if (field.type !== 'string') return;
    if (field.format === 'uri')
      this.assertUri(value, this.fieldTitle(field, key));
  }

  private assertRange(
    field: AiJsonSchemaProperty,
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
    constraints: AiFieldConstraint[],
    value: unknown,
    key: string,
    field: AiJsonSchemaProperty,
  ): void {
    for (const constraint of constraints) {
      if (constraint.kind === 'dimension2d') {
        this.assertDimension2d(constraint, String(value), key, field);
      }
    }
  }

  private assertDimension2d(
    constraint: Extract<AiFieldConstraint, { kind: 'dimension2d' }>,
    value: string,
    key: string,
    field: AiJsonSchemaProperty,
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

  private fieldTitle(field: AiJsonSchemaProperty, fallback: string): string {
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

  private validationError(
    message: string,
    issues?: readonly ValidationIssue[],
  ): BadRequestException {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      msg: message,
      ...(issues?.length ? { issues } : {}),
    });
  }
}
