import type { AiModelDefinition } from './types';

export interface ProviderModelCandidate<TAdapter> {
  adapter: TAdapter;
  provider: string;
  model: AiModelDefinition;
}

export function mergeCanonicalModels(
  models: AiModelDefinition[],
): AiModelDefinition[] {
  const groups = new Map<string, AiModelDefinition[]>();
  for (const model of models) {
    const key = model.ops?.canonicalSlug ?? model.id;
    const list = groups.get(key);
    if (list) list.push(model);
    else groups.set(key, [model]);
  }

  return Array.from(groups.values())
    .map((group) => mergeModelGroup(group))
    .sort(compareModelsForCatalog);
}

export function selectProviderModelCandidate<TAdapter>(
  candidates: ProviderModelCandidate<TAdapter>[],
): ProviderModelCandidate<TAdapter> | null {
  if (candidates.length === 0) return null;
  const enabled = candidates.filter((candidate) => candidate.model.enabled);
  const pool = enabled.length > 0 ? enabled : candidates;
  return [...pool].sort((a, b) => compareProviderModels(a.model, b.model))[0];
}

function mergeModelGroup(group: AiModelDefinition[]): AiModelDefinition {
  const sorted = [...group].sort(compareProviderModels);
  const primary = sorted[0];
  const enabled = sorted.some((model) => model.enabled);
  return {
    ...primary,
    enabled,
    disabledReason: enabled ? undefined : primary.disabledReason,
    documentation: dedupeDocumentation(
      sorted.flatMap((model) => model.documentation),
    ),
    availability: {
      ...primary.availability,
      regions: sorted.flatMap((model) => model.availability.regions),
    },
  };
}

function compareModelsForCatalog(
  a: AiModelDefinition,
  b: AiModelDefinition,
): number {
  const family = a.family.localeCompare(b.family);
  if (family !== 0) return family;
  const type = a.type.localeCompare(b.type);
  if (type !== 0) return type;
  return a.id.localeCompare(b.id);
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

function dedupeDocumentation(
  links: AiModelDefinition['documentation'],
): AiModelDefinition['documentation'] {
  const byKey = new Map<string, AiModelDefinition['documentation'][number]>();
  for (const link of links) {
    byKey.set(`${link.title}:${link.url}`, link);
  }
  return Array.from(byKey.values());
}
