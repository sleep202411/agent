import type {
  FoundryConditionExpression,
  FoundryInputSchema,
  FoundryJsonSchemaProperty,
  FoundryModelDefinition,
  FoundryProviderBinding,
} from '../../types';

export interface FoundryMappedProviderRequest {
  provider: string;
  endpoint: string;
  apiVersion?: string;
  requestContentType: FoundryProviderBinding['requestContentType'];
  body: Record<string, unknown>;
}

export function mapFoundryProviderRequest(
  model: FoundryModelDefinition,
  normalizedInput: Record<string, unknown>,
  options: { userId?: string } = {},
): FoundryMappedProviderRequest {
  const binding = model.provider_binding;
  const body: Record<string, unknown> = {};

  for (const [fieldName, field] of Object.entries(
    model.input_schema.properties,
  )) {
    const fieldBinding = field['x-provider'];
    if (!fieldBinding?.parameter && !fieldBinding?.path) continue;

    const raw = normalizedInput[fieldName];
    if (fieldBinding.omitIfEmpty && isEmpty(raw)) continue;
    if (
      fieldBinding.omitIfDefault &&
      field.default !== undefined &&
      raw === field.default
    ) {
      continue;
    }
    if (
      fieldBinding.omitWhen &&
      matchesCondition(fieldBinding.omitWhen, normalizedInput)
    ) {
      continue;
    }

    const value = transformProviderValue(field, raw);
    if (value === undefined) continue;
    setPath(body, fieldBinding.path ?? fieldBinding.parameter!, value);
  }

  if (binding.passthroughUserId && options.userId) body.user = options.userId;

  return {
    provider: binding.provider,
    endpoint: selectEndpoint(binding, normalizedInput),
    apiVersion: binding.apiVersion,
    requestContentType: binding.requestContentType,
    body,
  };
}

function selectEndpoint(
  binding: FoundryProviderBinding,
  input: Record<string, unknown>,
): string {
  const selector = binding.operationSelector;
  if (!selector) return binding.endpoint;
  return isEmpty(input[selector.field])
    ? selector.emptyEndpoint
    : selector.presentEndpoint;
}

function transformProviderValue(
  field: FoundryJsonSchemaProperty,
  value: unknown,
): unknown {
  const transform = field['x-provider']?.transform ?? 'identity';
  if (transform === 'omitAuto') return value === 'auto' ? undefined : value;
  if (transform === 'mediaArrayToOpenAIImageInput') {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'url' in item) {
        return (item as { url: unknown }).url;
      }
      return item;
    });
  }
  if (transform === 'uriArrayToFiles') {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    return value.map((item) =>
      item && typeof item === 'object' && 'url' in item
        ? (item as { url: unknown }).url
        : item,
    );
  }
  if (transform === 'secondsToDuration') return `${value}s`;
  return value;
}

function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const parts = path.split('.').filter(Boolean);
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] ?? path] = value;
}

function matchesCondition(
  condition: FoundryConditionExpression,
  input: Record<string, unknown>,
): boolean {
  if ('all' in condition && condition.all) {
    return condition.all.every((item) => matchesCondition(item, input));
  }
  if ('any' in condition && condition.any) {
    return condition.any.some((item) => matchesCondition(item, input));
  }
  if ('not' in condition && condition.not) {
    return !matchesCondition(condition.not, input);
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
      return !isEmpty(value);
    case 'empty':
      return isEmpty(value);
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

function isEmpty(value: unknown): boolean {
  return (
    value == null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}
