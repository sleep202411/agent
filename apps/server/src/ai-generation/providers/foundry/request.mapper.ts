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
  /**
   * Parameter names whose values are URL strings the adapter must
   * materialize (fetch) into Blobs before sending a multipart request.
   * Populated from schema bindings whose transform implies file-input
   * semantics (`mediaArrayToOpenAIImageInput`, `uriArrayToFiles`).
   * For JSON endpoints this list is observed but unused.
   */
  fileRefFields: string[];
}

/** Transforms whose output is a list of remote URL strings that need
 *  to be fetched into file parts when bound to a multipart endpoint. */
const FILE_REF_TRANSFORMS = new Set<string>([
  'mediaArrayToOpenAIImageInput',
  'uriArrayToFiles',
]);

export function mapFoundryProviderRequest(
  model: FoundryModelDefinition,
  normalizedInput: Record<string, unknown>,
  options: { userId?: string } = {},
): FoundryMappedProviderRequest {
  const binding = model.provider_binding;
  const body: Record<string, unknown> = {};
  const fileRefFields: string[] = [];

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
    const targetKey = fieldBinding.path ?? fieldBinding.parameter!;
    setPath(body, targetKey, value);
    // Schema-declared transforms whose output is a list of URLs need
    // a follow-up fetch step in the adapter when the endpoint is
    // multipart. We only track the top-level key (file refs aren't
    // bound to nested paths today). This is what makes the URL→Blob
    // hand-off schema-driven instead of hardcoded per parameter.
    if (
      fieldBinding.transform &&
      FILE_REF_TRANSFORMS.has(fieldBinding.transform) &&
      !targetKey.includes('.')
    ) {
      fileRefFields.push(targetKey);
    }
  }

  if (binding.passthroughUserId && options.userId) body.user = options.userId;

  // aspect_ratio + resolution_tier → Azure's single `size` field.
  // The two fields are user-facing (cleaner UX); Azure only takes
  // `WIDTHxHEIGHT`, so we combine here, after generic field mapping.
  // Backwards-compat: if a legacy caller sent `size` directly, the
  // generic loop above already set body.size and we don't overwrite.
  if (body.size === undefined) {
    const composed = composeSize(
      normalizedInput.aspect_ratio,
      normalizedInput.resolution_tier,
    );
    if (composed) body.size = composed;
  }

  return {
    provider: binding.provider,
    endpoint: selectEndpoint(binding, normalizedInput),
    apiVersion: binding.apiVersion,
    requestContentType: binding.requestContentType,
    body,
    fileRefFields,
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

// ─── aspect_ratio + resolution_tier → Azure size ──────────────
//
// 7 ratios × 3 tiers = 21 combos. Picking concrete pixel values per
// combo (not just multiplying) so we respect Azure's constraints:
//   * each dimension multiple of 16
//   * total pixels 655_360 – 8_294_400
//   * aspect ratio ≤ 3:1
// The 4K tier intentionally caps "off-square" ratios at 16:9 / 9:16
// so we stay under the 8.3M pixel ceiling.
const SIZE_GRID: Record<string, Record<string, string>> = {
  '1:1': {
    hd: '1024x1024', // 1.0 MP
    fhd: '2048x2048', // 4.2 MP
    uhd: '2880x2880', // 8.3 MP — at the pixel ceiling, still 1:1
  },
  '3:2': {
    hd: '1536x1024',
    fhd: '2304x1536',
    uhd: '3072x2048',
  },
  '2:3': {
    hd: '1024x1536',
    fhd: '1536x2304',
    uhd: '2048x3072',
  },
  '16:9': {
    hd: '1920x1088', // closest 16:9 with both dims multiples of 16
    fhd: '2048x1152',
    uhd: '3840x2160',
  },
  '9:16': {
    hd: '1088x1920',
    fhd: '1152x2048',
    uhd: '2160x3840',
  },
  '4:3': {
    hd: '1024x768',
    fhd: '2048x1536',
    uhd: '2880x2160',
  },
  '3:4': {
    hd: '768x1024',
    fhd: '1536x2048',
    uhd: '2160x2880',
  },
};

function composeSize(
  aspectRatio: unknown,
  resolutionTier: unknown,
): string | undefined {
  if (typeof aspectRatio !== 'string') return undefined;
  if (typeof resolutionTier !== 'string') return undefined;
  return SIZE_GRID[aspectRatio]?.[resolutionTier];
}
