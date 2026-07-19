import {
  assertStoryPatchComplexity,
  StoryPatchOperationsSchema,
  StoryPatchPreflightError,
  type StoryAgentCondition,
  type StoryAgentEffect,
  type StoryPatchOperation,
} from '@repo/shared/story-agent';
import { InteractiveFilmDraftContentSchema } from './interactive-film.schema';
import type { InteractiveFilmDraftContent } from './interactive-film.schema';

export interface StoryAgentCanvasLayoutSnapshot {
  nodePositions: Record<string, { x: number; y: number }>;
  storyWorldNodePresent: boolean;
}

export interface StoryPatchExecutionResult {
  draft: InteractiveFilmDraftContent;
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

type StoryGraphNode = InteractiveFilmDraftContent['graph']['nodes'][number];
type StoryCharacter =
  InteractiveFilmDraftContent['storyBible']['characters'][number];
type StoryStateVariable =
  InteractiveFilmDraftContent['storyBible']['stateVariables'][number];
type StoryEnding = InteractiveFilmDraftContent['storyBible']['endings'][number];

/**
 * Apply a typed Story patch as a pure, deterministic operation. It never mutates
 * the caller's draft/layout and performs no I/O. The database service owns CAS,
 * fencing and transactionality; this function owns domain semantics.
 */
export function executeStoryPatch(input: {
  draft: InteractiveFilmDraftContent;
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

  const parsedDraft = InteractiveFilmDraftContentSchema.safeParse(draft);
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
    layout.storyWorldNodePresent,
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
  draft: InteractiveFilmDraftContent;
  operation: StoryPatchOperation;
  affectedNodeIds: Set<string>;
  createdNodeIds: Set<string>;
}): void {
  const { draft, operation, affectedNodeIds, createdNodeIds } = input;
  switch (operation.kind) {
    case 'story_bible.update_overview':
      Object.assign(draft.storyBible, operation.payload);
      return;
    case 'story_bible.replace_story_rules':
      draft.storyBible.storyRules = [...operation.payload.storyRules];
      return;
    case 'story_bible.put_character': {
      const character = operation.payload.character as StoryCharacter;
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
      if (draftReferencesCharacter(draft, characterId)) {
        throw operationError(
          operation,
          'STORY_PATCH_ENTITY_REFERENCED',
          `Character ${characterId} is still referenced by a condition or effect. Update those references before removing it.`,
        );
      }
      draft.storyBible.characters = draft.storyBible.characters.filter(
        (value) => value.id !== characterId,
      );
      return;
    }
    case 'story_bible.replace_locations':
      draft.storyBible.locations = [...operation.payload.locations];
      return;
    case 'story_bible.replace_props':
      draft.storyBible.props = [...operation.payload.props];
      return;
    case 'story_bible.put_state_variable': {
      const variable = operation.payload.stateVariable as StoryStateVariable;
      draft.storyBible.stateVariables = putEntity({
        values: draft.storyBible.stateVariables,
        keyOf: (value) => value.key,
        key: variable.key,
        value: variable,
        intent: operation.payload.intent,
        operation,
        entityLabel: 'state variable',
      });
      return;
    }
    case 'story_bible.remove_state_variable': {
      const key = operation.payload.key;
      requireExistingEntity(
        draft.storyBible.stateVariables.some((value) => value.key === key),
        operation,
        'state variable',
        key,
      );
      if (draftReferencesStateVariable(draft, key)) {
        throw operationError(
          operation,
          'STORY_PATCH_ENTITY_REFERENCED',
          `State variable ${key} is still referenced by a condition or effect. Update those references before removing it.`,
        );
      }
      draft.storyBible.stateVariables = draft.storyBible.stateVariables.filter(
        (value) => value.key !== key,
      );
      return;
    }
    case 'story_bible.put_ending': {
      const ending = operation.payload.ending as StoryEnding;
      const existed = draft.storyBible.endings.some(
        (value) => value.id === ending.id,
      );
      draft.storyBible.endings = putEntity({
        values: draft.storyBible.endings,
        keyOf: (value) => value.id,
        key: ending.id,
        value: ending,
        intent: operation.payload.intent,
        operation,
        entityLabel: 'ending',
      });
      affectedNodeIds.add(ending.id);
      if (!existed) createdNodeIds.add(ending.id);
      return;
    }
    case 'story_bible.remove_ending': {
      const endingId = operation.payload.endingId;
      requireExistingEntity(
        draft.storyBible.endings.some((value) => value.id === endingId),
        operation,
        'ending',
        endingId,
      );
      if (draftReferencesEnding(draft, endingId)) {
        throw operationError(
          operation,
          'STORY_PATCH_ENTITY_REFERENCED',
          `Ending ${endingId} is still referenced by a node or effect. Update those references before removing it.`,
        );
      }
      draft.storyBible.endings = draft.storyBible.endings.filter(
        (value) => value.id !== endingId,
      );
      affectedNodeIds.add(endingId);
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
      const node = operation.payload.node as StoryGraphNode;
      const existed = draft.graph.nodes.some(
        (value) => value.nodeId === node.nodeId,
      );
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
  draft: InteractiveFilmDraftContent,
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
    if (node.kind === 'router') {
      const routes = node.exit.routes.filter(
        (route) => route.nextNodeId !== nodeId,
      );
      if (routes.length === node.exit.routes.length) return node;
      affectedNodeIds.add(node.nodeId);
      return { ...node, exit: { ...node.exit, routes } };
    }
    if (node.exit.kind === 'auto') {
      if (node.exit.nextNodeId !== nodeId) return node;
      affectedNodeIds.add(node.nodeId);
      return { ...node, exit: { kind: 'auto', nextNodeId: null } };
    }
    if (node.exit.kind === 'choice') {
      const removesTarget = node.exit.choices.some(
        (choice) => choice.nextNodeId === nodeId,
      );
      const resetsReaction =
        deletedNode.kind === 'clip' &&
        node.exit.choices.some(
          (choice) =>
            choice.afterSelect.kind === 'play' &&
            choice.afterSelect.reactionClipKey === deletedNode.clipKey,
        );
      if (!removesTarget && !resetsReaction) return node;
      const choices = node.exit.choices
        .filter((choice) => choice.nextNodeId !== nodeId)
        .map((choice) =>
          deletedNode.kind === 'clip' &&
          choice.afterSelect.kind === 'play' &&
          choice.afterSelect.reactionClipKey === deletedNode.clipKey
            ? { ...choice, afterSelect: { kind: 'immediate' as const } }
            : choice,
        );
      affectedNodeIds.add(node.nodeId);
      return { ...node, exit: { ...node.exit, choices } };
    }
    if (node.exit.kind === 'checkpoint' && node.exit.nextNodeId === nodeId) {
      affectedNodeIds.add(node.nodeId);
      return { ...node, exit: { kind: 'auto', nextNodeId: null } };
    }
    return node;
  });
}

function assertAgentDraftIntegrity(draft: InteractiveFilmDraftContent): void {
  const nodeIds = uniqueIdentitySet(
    draft.graph.nodes.map((node) => node.nodeId),
    'STORY_PATCH_DUPLICATE_NODE_ID',
    'Graph node ids must be unique.',
  );
  const endingIds = uniqueIdentitySet(
    draft.storyBible.endings.map((ending) => ending.id),
    'STORY_PATCH_DUPLICATE_ENDING_ID',
    'Ending ids must be unique.',
  );
  const clipKeys = uniqueIdentitySet(
    draft.graph.nodes.flatMap((node) =>
      node.kind === 'clip' ? [node.clipKey] : [],
    ),
    'STORY_PATCH_DUPLICATE_CLIP_KEY',
    'Clip keys must be unique.',
  );
  const characterIds = new Set(
    draft.storyBible.characters.map((character) => character.id),
  );
  const variableKeys = new Set(
    draft.storyBible.stateVariables.map((variable) => variable.key),
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
    if (
      node.kind === 'clip' &&
      node.exit.kind === 'ending' &&
      !endingIds.has(node.exit.endingId)
    ) {
      throw integrityError(
        'STORY_PATCH_DANGLING_ENDING_REFERENCE',
        `Node ${node.nodeId} references missing ending ${node.exit.endingId}.`,
      );
    }
    visitNodeConditionsAndEffects(node, {
      condition: (condition) => {
        if (condition.kind === 'variable' && !variableKeys.has(condition.key)) {
          throw integrityError(
            'STORY_PATCH_DANGLING_VARIABLE_REFERENCE',
            `A condition references missing state variable ${condition.key}.`,
          );
        }
        if (
          condition.kind === 'relationship-at-least' &&
          !characterIds.has(condition.characterId)
        ) {
          throw integrityError(
            'STORY_PATCH_DANGLING_CHARACTER_REFERENCE',
            `A condition references missing character ${condition.characterId}.`,
          );
        }
      },
      effect: (effect) => {
        if (
          (effect.kind === 'set_variable' ||
            effect.kind === 'increment_variable') &&
          !variableKeys.has(effect.key)
        ) {
          throw integrityError(
            'STORY_PATCH_DANGLING_VARIABLE_REFERENCE',
            `An effect references missing state variable ${effect.key}.`,
          );
        }
        if (
          effect.kind === 'adjust_relationship' &&
          !characterIds.has(effect.characterId)
        ) {
          throw integrityError(
            'STORY_PATCH_DANGLING_CHARACTER_REFERENCE',
            `An effect references missing character ${effect.characterId}.`,
          );
        }
        if (
          effect.kind === 'unlock_ending' &&
          !endingIds.has(effect.endingId)
        ) {
          throw integrityError(
            'STORY_PATCH_DANGLING_ENDING_REFERENCE',
            `An effect references missing ending ${effect.endingId}.`,
          );
        }
      },
    });
    if (node.kind === 'clip' && node.exit.kind === 'choice') {
      for (const choice of node.exit.choices) {
        if (
          choice.afterSelect.kind === 'play' &&
          !clipKeys.has(choice.afterSelect.reactionClipKey)
        ) {
          throw integrityError(
            'STORY_PATCH_DANGLING_CLIP_REFERENCE',
            `Choice ${choice.choiceId} references missing reaction clip ${choice.afterSelect.reactionClipKey}.`,
          );
        }
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
  if (node.kind === 'router') {
    return node.exit.routes.map((route) => route.nextNodeId);
  }
  if (node.exit.kind === 'auto') {
    return node.exit.nextNodeId ? [node.exit.nextNodeId] : [];
  }
  if (node.exit.kind === 'choice') {
    return node.exit.choices.map((choice) => choice.nextNodeId);
  }
  if (node.exit.kind === 'checkpoint') return [node.exit.nextNodeId];
  return [];
}

function draftReferencesCharacter(
  draft: InteractiveFilmDraftContent,
  characterId: string,
): boolean {
  return draft.graph.nodes.some((node) => {
    let referenced = false;
    visitNodeConditionsAndEffects(node, {
      condition: (condition) => {
        if (
          condition.kind === 'relationship-at-least' &&
          condition.characterId === characterId
        ) {
          referenced = true;
        }
      },
      effect: (effect) => {
        if (
          effect.kind === 'adjust_relationship' &&
          effect.characterId === characterId
        ) {
          referenced = true;
        }
      },
    });
    return referenced;
  });
}

function draftReferencesStateVariable(
  draft: InteractiveFilmDraftContent,
  key: string,
): boolean {
  return draft.graph.nodes.some((node) => {
    let referenced = false;
    visitNodeConditionsAndEffects(node, {
      condition: (condition) => {
        if (condition.kind === 'variable' && condition.key === key) {
          referenced = true;
        }
      },
      effect: (effect) => {
        if (
          (effect.kind === 'set_variable' ||
            effect.kind === 'increment_variable') &&
          effect.key === key
        ) {
          referenced = true;
        }
      },
    });
    return referenced;
  });
}

function draftReferencesEnding(
  draft: InteractiveFilmDraftContent,
  endingId: string,
): boolean {
  return draft.graph.nodes.some((node) => {
    if (
      node.kind === 'clip' &&
      node.exit.kind === 'ending' &&
      node.exit.endingId === endingId
    ) {
      return true;
    }
    let referenced = false;
    visitNodeConditionsAndEffects(node, {
      condition: () => undefined,
      effect: (effect) => {
        if (effect.kind === 'unlock_ending' && effect.endingId === endingId) {
          referenced = true;
        }
      },
    });
    return referenced;
  });
}

function visitNodeConditionsAndEffects(
  node: StoryGraphNode,
  visitor: {
    condition: (condition: StoryAgentCondition) => void;
    effect: (effect: StoryAgentEffect) => void;
  },
): void {
  if (node.kind === 'router') {
    node.exit.routes.forEach((route) => {
      if (route.when) visitCondition(route.when, visitor.condition);
    });
    return;
  }
  if (node.exit.kind !== 'choice') return;
  node.exit.choices.forEach((choice) => {
    if (choice.visibleWhen) {
      visitCondition(choice.visibleWhen, visitor.condition);
    }
    choice.effects.forEach((effect) =>
      visitor.effect(effect as StoryAgentEffect),
    );
  });
}

function visitCondition(
  condition: StoryAgentCondition,
  visitor: (condition: StoryAgentCondition) => void,
): void {
  visitor(condition);
  if (condition.kind === 'all' || condition.kind === 'any') {
    condition.conditions.forEach((child) => visitCondition(child, visitor));
  } else if (condition.kind === 'not') {
    visitCondition(condition.condition, visitor);
  }
}

function removeOrphanedCanvasPositions(
  positions: Record<string, { x: number; y: number }>,
  draft: InteractiveFilmDraftContent,
  storyWorldNodePresent: boolean,
): Record<string, { x: number; y: number }> {
  const validIds = new Set<string>();
  if (storyWorldNodePresent) validIds.add('__story_root__');
  draft.graph.nodes.forEach((node) => {
    validIds.add(node.nodeId);
    if (node.kind === 'clip' && node.exit.kind === 'choice') {
      validIds.add(`__decision__:${node.nodeId}`);
    }
  });
  draft.storyBible.endings.forEach((ending) => {
    validIds.add(`__ending__:${ending.id}`);
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
