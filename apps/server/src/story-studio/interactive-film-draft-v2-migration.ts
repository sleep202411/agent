import { createHash } from 'node:crypto';
import {
  InteractiveFilmDraftContentSchema,
  type InteractiveFilmDraftContent,
} from './interactive-film.schema';

export const LEGACY_INTERACTIVE_FILM_DRAFT_SCHEMA_VERSION =
  'interactive-film-draft-v1' as const;

/**
 * One-way storage migration from the v1 authoring graph to v2.
 *
 * v2 gives a clip exactly one direct continuation. Conditional or multiple
 * v1 routes are preserved by inserting a graph-only router, so migration is
 * lossless and condition ownership remains explicit.
 */
export function migrateInteractiveFilmDraftV1ToV2(
  input: unknown,
): InteractiveFilmDraftContent {
  const draft = structuredClone(input);
  if (!isRecord(draft) || !isRecord(draft.graph)) {
    throw new Error('Draft v1 content must contain a graph object.');
  }
  const nodes = draft.graph.nodes;
  if (!Array.isArray(nodes)) {
    throw new Error('Draft v1 graph.nodes must be an array.');
  }

  const occupiedNodeIds = new Set(
    nodes.flatMap((node) =>
      isRecord(node) && typeof node.nodeId === 'string' ? [node.nodeId] : [],
    ),
  );
  const migratedRouters: Record<string, unknown>[] = [];

  for (const node of nodes) {
    if (!isRecord(node) || node.kind !== 'clip' || !isRecord(node.exit)) {
      continue;
    }
    if (node.exit.kind !== 'auto') continue;
    if (!Array.isArray(node.exit.routes)) {
      throw new Error(
        `Draft v1 clip ${String(node.nodeId)} has no automatic routes array.`,
      );
    }

    const routes = node.exit.routes;
    const directRoute: unknown = routes.length === 1 ? routes[0] : null;
    if (
      isRecord(directRoute) &&
      typeof directRoute.nextNodeId === 'string' &&
      directRoute.when === undefined
    ) {
      node.exit = { kind: 'auto', nextNodeId: directRoute.nextNodeId };
      continue;
    }
    if (routes.length === 0) {
      node.exit = { kind: 'auto', nextNodeId: null };
      continue;
    }

    const sourceNodeId = String(node.nodeId);
    const routerNodeId = allocateRouterNodeId(sourceNodeId, occupiedNodeIds);
    occupiedNodeIds.add(routerNodeId);
    migratedRouters.push({
      kind: 'router',
      nodeId: routerNodeId,
      exit: { kind: 'auto', routes },
    });
    node.exit = { kind: 'auto', nextNodeId: routerNodeId };
  }

  nodes.push(...migratedRouters);
  return InteractiveFilmDraftContentSchema.parse(draft);
}

function allocateRouterNodeId(
  sourceNodeId: string,
  occupied: Set<string>,
): string {
  const digest = createHash('sha256')
    .update(sourceNodeId)
    .digest('hex')
    .slice(0, 20);
  const base = `router:migrated:${digest}`;
  if (!occupied.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}:${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a router node for ${sourceNodeId}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
