import {
  assertStoryPatchComplexity,
  StoryPatchOperationsSchema,
  StoryPatchPreflightError,
  type StoryPatchOperation,
} from '@repo/shared/story-agent';
import { InteractiveStoryDraftContentSchema } from './interactive-film.schema';
import type { InteractiveStoryDraftContent } from './interactive-film.schema';

export interface StoryAgentCanvasLayoutSnapshot {
  nodePositions: Record<string, { x: number; y: number }>;
}

export interface StoryPatchExecutionResult {
  draft: InteractiveStoryDraftContent;
  layout: StoryAgentCanvasLayoutSnapshot;
  affectedNodeIds: string[];
  createdNodeIds: string[];
  draftChanged: boolean;
  layoutChanged: boolean;
}

export class StoryPatchExecutionError extends Error {
  readonly code: string;
  readonly operationId: string | null;
  readonly path: PropertyKey[];

  constructor(input: {
    code: string;
    message: string;
    operationId?: string | null;
    path?: PropertyKey[];
  }) {
    super(input.message);
    this.name = 'StoryPatchExecutionError';
    this.code = input.code;
    this.operationId = input.operationId ?? null;
    this.path = input.path ?? [];
  }
}

type StoryGraphNode = InteractiveStoryDraftContent['graph']['nodes'][number];
type StoryCharacter =
  InteractiveStoryDraftContent['storyBible']['characters'][number];

/**
 * Apply a typed Story patch as a pure, deterministic operation. It never mutates
 * the caller's draft/layout and performs no I/O. The database service owns CAS,
 * fencing and transactionality; this function owns domain semantics.
 */
export function executeStoryPatch(input: {
  draft: InteractiveStoryDraftContent;
  layout: StoryAgentCanvasLayoutSnapshot;
  operations: readonly StoryPatchOperation[];
}): StoryPatchExecutionResult {
  let operations: StoryPatchOperation[];
  try {
    assertStoryPatchComplexity(input.operations);
    operations = StoryPatchOperationsSchema.parse(input.operations);
  } catch (error) {
    if (error instanceof StoryPatchPreflightError) {
      throw new StoryPatchExecutionError({
        code: error.code,
        message: error.message,
        path: [error.path],
      });
    }
    throw error;
  }
  const draft = structuredClone(input.draft);
  const layout = structuredClone(input.layout);
  const beforeDraft = JSON.stringify(input.draft);
  const beforeLayout = JSON.stringify(input.layout);
  const affectedNodeIds = new Set<string>();
  const createdNodeIds = new Set<string>();

  for (const operation of operations) {
    applyOperation({
      draft,
      operation,
      affectedNodeIds,
      createdNodeIds,
    });
  }

  const parsedDraft = InteractiveStoryDraftContentSchema.safeParse(draft);
  if (!parsedDraft.success) {
    const issue = parsedDraft.error.issues[0];
    throw new StoryPatchExecutionError({
      code: 'STORY_PATCH_INVALID_RESULT',
      message: issue?.message ?? 'The Story patch produced an invalid draft.',
      path: issue?.path ?? [],
    });
  }
  assertAgentDraftIntegrity(parsedDraft.data);

  layout.nodePositions = removeOrphanedCanvasPositions(
    layout.nodePositions,
    parsedDraft.data,
  );

  return {
    draft: parsedDraft.data,
    layout,
    affectedNodeIds: [...affectedNodeIds].sort(),
    createdNodeIds: [...createdNodeIds].sort(),
    draftChanged: beforeDraft !== JSON.stringify(parsedDraft.data),
    layoutChanged: beforeLayout !== JSON.stringify(layout),
  };
}

function applyOperation(input: {
  draft: InteractiveStoryDraftContent;
  operation: StoryPatchOperation;
  affectedNodeIds: Set<string>;
  createdNodeIds: Set<string>;
}): void {
  const { draft, operation, affectedNodeIds, createdNodeIds } = input;
  switch (operation.kind) {
    case 'story_bible.update_overview':
      Object.assign(draft.storyBible, operation.payload);
      return;
    case 'story_bible.put_character': {
      // The agent authors narrative fields only; appearance images and the
      // voice sample are uploaded by humans and survive an agent replace.
      const incoming = operation.payload.character;
      const existing = draft.storyBible.characters.find(
        (value) => value.id === incoming.id,
      );
      const character: StoryCharacter = {
        ...incoming,
        images: existing?.images ?? [],
        voice: existing?.voice ?? null,
      };
      draft.storyBible.characters = putEntity({
        values: draft.storyBible.characters,
        keyOf: (value) => value.id,
        key: character.id,
        value: character,
        intent: operation.payload.intent,
        operation,
        entityLabel: 'character',
      });
      return;
    }
    case 'story_bible.remove_character': {
      const characterId = operation.payload.characterId;
      requireExistingEntity(
        draft.storyBible.characters.some((value) => value.id === characterId),
        operation,
        'character',
        characterId,
      );
      draft.storyBible.characters = draft.storyBible.characters.filter(
        (value) => value.id !== characterId,
      );
      return;
    }
    case 'story_graph.set_entry_node': {
      const nodeId = operation.payload.nodeId;
      if (nodeId !== null) {
        requireExistingEntity(
          draft.graph.nodes.some((node) => node.nodeId === nodeId),
          operation,
          'graph node',
          nodeId,
        );
        affectedNodeIds.add(nodeId);
      }
      draft.graph.entryNodeId = nodeId;
      return;
    }
    case 'story_graph.put_node': {
      const incoming = operation.payload.node as StoryGraphNode;
      const existing = draft.graph.nodes.find(
        (value) => value.nodeId === incoming.nodeId,
      );
      const node: StoryGraphNode = incoming;
      const existed = existing !== undefined;
      draft.graph.nodes = putEntity({
        values: draft.graph.nodes,
        keyOf: (value) => value.nodeId,
        key: node.nodeId,
        value: node,
        intent: operation.payload.intent,
        operation,
        entityLabel: 'graph node',
      });
      affectedNodeIds.add(node.nodeId);
      if (!existed) createdNodeIds.add(node.nodeId);
      return;
    }
    case 'story_graph.remove_node':
      removeGraphNode(draft, operation, affectedNodeIds);
      return;
    case 'story_graph.reorder_nodes': {
      const currentIds = draft.graph.nodes.map((node) => node.nodeId);
      const orderedIds = operation.payload.nodeIds;
      if (
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.length !== currentIds.length ||
        currentIds.some((nodeId) => !orderedIds.includes(nodeId))
      ) {
        throw operationError(
          operation,
          'STORY_PATCH_INVALID_NODE_ORDER',
          'reorder_nodes must contain every current graph node exactly once.',
        );
      }
      const nodesById = new Map(
        draft.graph.nodes.map((node) => [node.nodeId, node]),
      );
      draft.graph.nodes = orderedIds.map((nodeId) => nodesById.get(nodeId)!);
      orderedIds.forEach((nodeId) => affectedNodeIds.add(nodeId));
      return;
    }
    case 'production.replace_notes':
      draft.productionNotes = [...operation.payload.productionNotes];
      return;
  }
}

function putEntity<T>(input: {
  values: T[];
  keyOf: (value: T) => string;
  key: string;
  value: T;
  intent: 'create' | 'replace';
  operation: StoryPatchOperation;
  entityLabel: string;
}): T[] {
  const index = input.values.findIndex(
    (value) => input.keyOf(value) === input.key,
  );
  if (input.intent === 'create' && index !== -1) {
    throw operationError(
      input.operation,
      'STORY_PATCH_CREATE_CONFLICT',
      `Cannot create ${input.entityLabel} ${input.key} because it already exists.`,
    );
  }
  if (input.intent === 'replace' && index === -1) {
    throw operationError(
      input.operation,
      'STORY_PATCH_REPLACE_MISSING',
      `Cannot replace ${input.entityLabel} ${input.key} because it does not exist.`,
    );
  }
  if (index === -1) return [...input.values, structuredClone(input.value)];
  return input.values.map((value, valueIndex) =>
    valueIndex === index ? structuredClone(input.value) : value,
  );
}

function requireExistingEntity(
  exists: boolean,
  operation: StoryPatchOperation,
  entityLabel: string,
  entityId: string,
): void {
  if (exists) return;
  // Verb-neutral: this guard also serves reference ops (e.g. set_entry_node),
  // and the text is fed back to the author model as repair context.
  throw operationError(
    operation,
    'STORY_PATCH_ENTITY_MISSING',
    `Cannot reference ${entityLabel} ${entityId} because it does not exist at this point in the document.`,
  );
}

function removeGraphNode(
  draft: InteractiveStoryDraftContent,
  operation: Extract<StoryPatchOperation, { kind: 'story_graph.remove_node' }>,
  affectedNodeIds: Set<string>,
): void {
  const nodeId = operation.payload.nodeId;
  const deletedNode = draft.graph.nodes.find((node) => node.nodeId === nodeId);
  if (!deletedNode) {
    throw operationError(
      operation,
      'STORY_PATCH_ENTITY_MISSING',
      `Cannot remove graph node ${nodeId} because it does not exist.`,
    );
  }
  draft.graph.nodes = draft.graph.nodes.filter(
    (node) => node.nodeId !== nodeId,
  );
  affectedNodeIds.add(nodeId);
  if (draft.graph.entryNodeId === nodeId) draft.graph.entryNodeId = null;

  draft.graph.nodes = draft.graph.nodes.map((node) => {
    if (node.kind === 'world') {
      if (node.exit.nextNodeId !== nodeId) return node;
      affectedNodeIds.add(node.nodeId);
      return { ...node, exit: { kind: 'auto' as const, nextNodeId: null } };
    }
    if (node.exit.kind === 'auto') {
      if (node.exit.nextNodeId !== nodeId) return node;
      affectedNodeIds.add(node.nodeId);
      return { ...node, exit: { kind: 'auto', nextNodeId: null } };
    }
    if (!node.exit.choices.some((choice) => choice.nextNodeId === nodeId)) {
      return node;
    }
    const choices = node.exit.choices.filter(
      (choice) => choice.nextNodeId !== nodeId,
    );
    affectedNodeIds.add(node.nodeId);
    return { ...node, exit: { ...node.exit, choices } };
  });
}

function assertAgentDraftIntegrity(draft: InteractiveStoryDraftContent): void {
  const nodeIds = uniqueIdentitySet(
    draft.graph.nodes.map((node) => node.nodeId),
    'STORY_PATCH_DUPLICATE_NODE_ID',
    'Graph node ids must be unique.',
  );
  // Enforced for its throw-on-duplicate side effect; clip keys are no longer
  // referenced elsewhere now that choices carry no reaction clip.
  uniqueIdentitySet(
    draft.graph.nodes.flatMap((node) =>
      node.kind === 'clip' ? [node.clipKey] : [],
    ),
    'STORY_PATCH_DUPLICATE_CLIP_KEY',
    'Clip keys must be unique.',
  );

  if (draft.graph.entryNodeId && !nodeIds.has(draft.graph.entryNodeId)) {
    throw integrityError(
      'STORY_PATCH_DANGLING_ENTRY',
      `Entry node ${draft.graph.entryNodeId} does not exist.`,
    );
  }

  for (const node of draft.graph.nodes) {
    const targets = graphNodeTargets(node);
    for (const target of targets) {
      if (!nodeIds.has(target)) {
        throw integrityError(
          'STORY_PATCH_DANGLING_NODE_REFERENCE',
          `Node ${node.nodeId} references missing node ${target}.`,
        );
      }
    }
  }
}

function uniqueIdentitySet(
  values: string[],
  code: string,
  message: string,
): Set<string> {
  const set = new Set(values);
  if (set.size !== values.length) throw integrityError(code, message);
  return set;
}

function graphNodeTargets(node: StoryGraphNode): string[] {
  if (node.exit.kind === 'auto') {
    return node.exit.nextNodeId ? [node.exit.nextNodeId] : [];
  }
  return node.exit.choices.map((choice) => choice.nextNodeId);
}

function removeOrphanedCanvasPositions(
  positions: Record<string, { x: number; y: number }>,
  draft: InteractiveStoryDraftContent,
): Record<string, { x: number; y: number }> {
  const validIds = new Set<string>();
  draft.graph.nodes.forEach((node) => {
    validIds.add(node.nodeId);
    if (node.exit.kind === 'choice') {
      validIds.add(`__decision__:${node.nodeId}`);
    }
  });
  return Object.fromEntries(
    Object.entries(positions)
      .filter(([nodeId]) => validIds.has(nodeId))
      .map(([nodeId, position]) => [nodeId, { ...position }]),
  );
}

function operationError(
  operation: StoryPatchOperation,
  code: string,
  message: string,
): StoryPatchExecutionError {
  return new StoryPatchExecutionError({
    code,
    message,
    operationId: operation.operationId,
  });
}

function integrityError(
  code: string,
  message: string,
): StoryPatchExecutionError {
  return new StoryPatchExecutionError({ code, message });
}
