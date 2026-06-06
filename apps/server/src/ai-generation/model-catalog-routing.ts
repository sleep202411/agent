import type { AiModelDefinition } from './types';

/**
 * Submit-time multi-provider routing helpers.
 *
 * The catalog is canonical-model-driven (see AiCanonicalCatalogService),
 * so it no longer merges N provider definitions into one — there is one
 * entry per canonical by construction. What remains here is the
 * submit-time candidate selection: `routing.findModel` asks every
 * provider for the submitted modelId, and when more than one provider
 * binds the same canonical, `selectProviderModelCandidate` picks the
 * primary by route priority/weight (multi-provider failover).
 */
export interface ProviderModelCandidate<TAdapter> {
  adapter: TAdapter;
  provider: string;
  model: AiModelDefinition;
}

export function selectProviderModelCandidate<TAdapter>(
  candidates: ProviderModelCandidate<TAdapter>[],
): ProviderModelCandidate<TAdapter> | null {
  if (candidates.length === 0) return null;
  const enabled = candidates.filter((candidate) => candidate.model.enabled);
  const pool = enabled.length > 0 ? enabled : candidates;
  return [...pool].sort((a, b) => compareProviderModels(a.model, b.model))[0];
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
