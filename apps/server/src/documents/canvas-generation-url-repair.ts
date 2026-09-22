import * as Y from 'yjs';

export interface CanvasGenerationUrlRepair {
  nodeId: string;
  jobId: string;
  assetId: string;
  url: string;
}

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/** Only URLs change; identities, generation receipts and user edits are retained. */
export function repairCanvasGenerationUrls(
  doc: Y.Doc,
  repairs: readonly CanvasGenerationUrlRepair[],
) {
  const nodes = doc.getMap('nodes');
  const assets = doc.getMap('assets');
  const mutations: Array<() => void> = [];
  const changes: Array<{
    nodeId: string;
    assetId: string;
    field: string;
    before: string;
    after: string;
  }> = [];
  if (new Set(repairs.map((r) => r.nodeId)).size !== repairs.length) {
    throw new Error('Duplicate repair node');
  }
  // Validate the entire plan before changing any Yjs value.
  for (const repair of repairs) {
    const url = new URL(repair.url);
    if (url.protocol !== 'https:' || url.search || url.hash) {
      throw new Error('Repair requires a durable public HTTPS URL');
    }
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      throw new Error('R2 API endpoints are not public media URLs');
    }
    const node: unknown = nodes.get(repair.nodeId);
    const data: unknown =
      node instanceof Y.Map ? (node.get('data') as unknown) : null;
    const dataMap = data instanceof Y.Map ? (data as Y.Map<unknown>) : null;
    const generation = asJsonObject(dataMap?.get('generation'));
    const outputs = Array.isArray(generation?.outputs)
      ? generation.outputs
          .map(asJsonObject)
          .filter((value): value is JsonObject => value !== null)
      : [];
    if (
      !generation ||
      generation.jobId !== repair.jobId ||
      generation.status !== 'done' ||
      outputs.length !== 1 ||
      outputs[0]?.assetId !== repair.assetId
    ) {
      throw new Error(`Generation identity conflict: ${repair.nodeId}`);
    }
    const asset: unknown = assets.get(repair.assetId);
    const assetObject = asJsonObject(asset);
    if (
      !assetObject ||
      assetObject.id !== repair.assetId ||
      assetObject.mediaAssetId !== repair.assetId
    ) {
      throw new Error(`Canvas asset identity conflict: ${repair.assetId}`);
    }
    const output = outputs[0];
    for (const [field, before] of [
      ['generation.outputs[0].url', output.url],
      ['assets.url', assetObject.url],
    ]) {
      if (typeof before !== 'string')
        throw new Error(`Missing URL: ${String(field)}`);
      if (before !== repair.url) {
        changes.push({
          nodeId: repair.nodeId,
          assetId: repair.assetId,
          field: String(field),
          before,
          after: repair.url,
        });
      }
    }
    if (!dataMap) throw new Error(`Canvas node data missing: ${repair.nodeId}`);
    if (output.url !== repair.url) {
      mutations.push(() =>
        dataMap.set('generation', {
          ...generation,
          outputs: [{ ...output, url: repair.url }],
        }),
      );
    }
    if (assetObject.url !== repair.url) {
      mutations.push(() =>
        assets.set(repair.assetId, { ...assetObject, url: repair.url }),
      );
    }
  }
  doc.transact(
    () => mutations.forEach((mutate) => mutate()),
    'media-url-repair',
  );
  return changes;
}
