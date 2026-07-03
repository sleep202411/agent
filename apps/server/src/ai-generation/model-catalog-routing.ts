import type { AiModelDefinition } from './types';

/**
 * Submit-time multi-provider routing helpers.
 *
 * The catalog is canonical-model-driven (see AiCanonicalCatalogService),
 * so it no longer merges N provider definitions into one — there is one
 * entry per canonical by construction. What remains here is the
 * submit-time candidate selection: `routing.findModel` asks every
 * provider for the submitted modelId, and when more than one provider
 * binds the same canonical, `selectProviderModelCandidate` picks the primary
 * by route priority/weight. Worker retries preserve the submit-time routing
 * snapshot; this helper only chooses the primary provider candidate.
 */
export interface ProviderModelCandidate<TAdapter> {
  adapter: TAdapter;
  provider: string;
  model: AiModelDefinition;
}

export function selectProviderModelCandidate<TAdapter>(
  candidates: ProviderModelCandidate<TAdapter>[],
  input?: Record<string, unknown>,
): ProviderModelCandidate<TAdapter> | null {
  if (candidates.length === 0) return null;
  const enabled = candidates.filter((candidate) => candidate.model.enabled);
  const pool = enabled.length > 0 ? enabled : candidates;
  const supported = input
    ? pool.filter((candidate) => modelSupportsInput(candidate.model, input))
    : pool;
  if (supported.length === 0) return null;
  return [...supported].sort((a, b) =>
    compareProviderModels(a.model, b.model),
  )[0];
}

function compareProviderModels(
  a: AiModelDefinition,
  b: AiModelDefinition,
): number {
  const priority = routePriority(a) - routePriority(b);
  if (priority !== 0) return priority;
  const weight = routeWeight(b) - routeWeight(a);
  if (weight !== 0) return weight;
  const provider = a.provider.localeCompare(b.provider);
  if (provider !== 0) return provider;
  return a.deployment.localeCompare(b.deployment);
}

function routePriority(model: AiModelDefinition): number {
  const ops = model.ops;
  return ops && Number.isFinite(ops.providerRoutePriority)
    ? ops.providerRoutePriority
    : 10_000;
}

function routeWeight(model: AiModelDefinition): number {
  const ops = model.ops;
  return ops && Number.isFinite(ops.providerRouteWeight)
    ? ops.providerRouteWeight
    : 0;
}

function modelSupportsInput(
  model: AiModelDefinition,
  input: Record<string, unknown>,
): boolean {
  const schema = model.input_schema;
  const properties = schema.properties ?? {};

  for (const [field, raw] of Object.entries(input)) {
    if (isEmptyInputValue(raw)) continue;
    const property = properties[field];
    if (!property) {
      if (isRouteRelevantField(field)) return false;
      continue;
    }

    const enumValues = Array.isArray(property.enum) ? property.enum : null;
    if (
      enumValues &&
      (typeof raw === 'string' || typeof raw === 'number') &&
      !enumValues.includes(raw)
    ) {
      return false;
    }

    if (Array.isArray(raw)) {
      const propertyRecord = recordValue(property);
      const maxItems =
        typeof propertyRecord?.maxItems === 'number' &&
        Number.isFinite(propertyRecord.maxItems)
          ? propertyRecord.maxItems
          : null;
      const minItems =
        typeof propertyRecord?.minItems === 'number' &&
        Number.isFinite(propertyRecord.minItems)
          ? propertyRecord.minItems
          : null;
      if (maxItems != null && raw.length > maxItems) return false;
      if (minItems != null && raw.length < minItems) return false;
    }
  }

  return true;
}

function isRouteRelevantField(field: string): boolean {
  return (
    field === 'imageSize' ||
    field === 'aspectRatio' ||
    field === 'resolution' ||
    field === 'quality' ||
    field === 'numOutputs' ||
    field === 'outputFormat' ||
    field === 'referenceImages' ||
    // Omni-reference videos/audios: route-relevant so a request carrying them
    // only lands on a provider whose schema declares them — a provider that
    // doesn't would silently drop the reference.
    field === 'referenceVideos' ||
    field === 'referenceAudios' ||
    field === 'maskImage' ||
    field === 'startFrame' ||
    field === 'endFrame'
  );
}

function isEmptyInputValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
