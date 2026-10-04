import type {
  ExperienceAccessRequirement,
  ExperienceJourneyAccessRef,
  ExperienceCondition,
  ExperienceEventBinding,
  ExperienceGraphNode,
  ExperienceJsonObject,
  ExperienceJsonValue,
  ExperienceRuntimeAction,
  ExperienceRuntimeManifest,
  ExperienceScopedStateSnapshot,
  ExperienceStateDefinition,
  ExperienceStateScope,
  ExperienceValueExpression,
} from "@repo/shared/experience-runtime";
import {
  createExperienceDeterministicRuntimeState,
  resolveExperienceAudioPlayback,
  type ExperienceDeterministicRuntimeState,
} from "./audio-runtime.js";

export class ExperienceAccessRequiredError extends Error {
  readonly code = "EXPERIENCE_ACCESS_REQUIRED";
  events: ExperienceRuntimeEvent[] = [];
  constructor(readonly requirement: ExperienceAccessRequirement) {
    super("Community Points unlock required.");
    this.name = "ExperienceAccessRequiredError";
  }
}
export type ExperienceAccessCheck = (requirement: ExperienceAccessRequirement) => boolean;

function requireAccess(
  access: ExperienceAccessRequirement | undefined,
  canAccess?: ExperienceAccessCheck,
  ref?: ExperienceJourneyAccessRef,
  effects?: ExperienceRuntimeEffect[]
) {
  if (access && !canAccess?.(access)) throw new ExperienceAccessRequiredError(access);
  if (access && ref && effects) effects.push({ kind: "access.checked", ref });
}

export interface ExperienceRuntimeEvent {
  type: string;
  sourceId?: string;
  qualifierId?: string;
  payload?: ExperienceJsonObject;
  context?: ExperienceJsonObject;
}

export interface ExperienceRuntimeState {
  currentSceneId: string;
  status: "active" | "completed";
  completedEndingId?: string;
  values: ExperienceScopedStateSnapshot;
  watchedAssetIds: string[];
  unlockedEndingIds: string[];
  completedEndingIds: string[];
  deterministicRuntime: ExperienceDeterministicRuntimeState;
}

export type ExperienceRuntimeEffect =
  | { kind: "access.checked"; ref: ExperienceJourneyAccessRef }
  | {
      kind: "scene.changed";
      fromSceneId: string;
      toSceneId: string;
      bindingId: string;
      routeId: string;
    }
  | {
      kind: "ending.completed";
      fromSceneId: string;
      endingId: string;
      bindingId: string;
      routeId: string;
    }
  | {
      kind: "renderer.command";
      instanceId: string;
      commandType: string;
      payload: ExperienceJsonObject;
    }
  | {
      kind: "audio.play";
      cueId: string;
      assetId: string;
      playbackRate: number;
      playbackOrdinal: number;
      playbackId?: string;
    }
  | {
      kind: "audio.stop";
      target: "cue" | "playback";
      targetId: string;
      fadeOutMs?: number;
    }
  | { kind: "audio.fade-bus"; busId: string; gain: number; durationMs: number }
  | { kind: "audio.apply-snapshot"; snapshotId: string }
  | {
      kind: "event.emit";
      eventType: string;
      sourceId?: string;
      qualifierId?: string;
      payload: ExperienceJsonObject;
    }
  | { kind: "telemetry.emit"; eventName: string; payload: ExperienceJsonObject }
  | { kind: "session.checkpoint"; checkpointId: string };

export interface ExperienceDispatchResult {
  state: ExperienceRuntimeState;
  handled: boolean;
  bindingId?: string;
  routeId?: string;
  effects: ExperienceRuntimeEffect[];
}

export interface ExperienceEventQueueResult {
  state: ExperienceRuntimeState;
  effects: ExperienceRuntimeEffect[];
  processedEventCount: number;
}

export interface ExperienceRuntimeRestoreInput {
  currentSceneId: string;
  status: ExperienceRuntimeState["status"];
  completedEndingId?: string;
  values: ExperienceScopedStateSnapshot;
  watchedAssetIds?: readonly string[];
  unlockedEndingIds?: readonly string[];
  completedEndingIds?: readonly string[];
  deterministicRuntime: ExperienceDeterministicRuntimeState;
}

export class ExperienceRuntimeInvariantError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ExperienceRuntimeInvariantError";
  }
}

export function initializeExperienceRuntime(
  manifest: ExperienceRuntimeManifest,
  options: { randomSeed?: string } = {}
): ExperienceRuntimeState {
  const values = createInitialScopedState(manifest.stateDefinitions);
  return {
    currentSceneId: manifest.graph.entrySceneId,
    status: "active",
    values,
    watchedAssetIds: [],
    unlockedEndingIds: [],
    completedEndingIds: [],
    deterministicRuntime: createExperienceDeterministicRuntimeState(options.randomSeed),
  };
}

export function restoreExperienceRuntime(
  manifest: ExperienceRuntimeManifest,
  input: ExperienceRuntimeRestoreInput
): ExperienceRuntimeState {
  if (!manifest.graph.nodes.some((node) => node.sceneId === input.currentSceneId)) {
    throw new ExperienceRuntimeInvariantError(
      "RESTORE_SCENE_UNKNOWN",
      `Cannot restore unknown scene ${input.currentSceneId}`
    );
  }
  if (input.status === "completed") {
    if (
      !input.completedEndingId ||
      !manifest.endings.some((ending) => ending.endingId === input.completedEndingId)
    ) {
      throw new ExperienceRuntimeInvariantError(
        "RESTORE_ENDING_INVALID",
        "Completed runtime state requires a declared completed ending"
      );
    }
  } else if (input.completedEndingId) {
    throw new ExperienceRuntimeInvariantError(
      "RESTORE_ENDING_INVALID",
      "Active runtime state cannot contain a completed ending"
    );
  }

  const values = createEmptyScopedState();
  const definitions = new Map(
    manifest.stateDefinitions.map((definition) => [definition.key, definition])
  );
  for (const scope of STATE_SCOPES) {
    for (const [key, value] of Object.entries(input.values[scope])) {
      const definition = definitions.get(key);
      if (!definition) {
        throw new ExperienceRuntimeInvariantError(
          "RESTORE_STATE_UNKNOWN",
          `Cannot restore undeclared state ${key}`
        );
      }
      if (definition.scope !== scope) {
        throw new ExperienceRuntimeInvariantError(
          "RESTORE_STATE_SCOPE",
          `State ${key} belongs to ${definition.scope}, not ${scope}`
        );
      }
      assertStateValue(definition, value);
      values[scope][key] = structuredClone(value);
    }
  }
  manifest.stateDefinitions.forEach((definition) => {
    if (Object.prototype.hasOwnProperty.call(values[definition.scope], definition.key)) return;
    throw new ExperienceRuntimeInvariantError(
      "RESTORE_STATE_MISSING",
      `Restore snapshot is missing state ${definition.key}`
    );
  });

  return {
    currentSceneId: input.currentSceneId,
    status: input.status,
    ...(input.completedEndingId ? { completedEndingId: input.completedEndingId } : {}),
    values,
    watchedAssetIds: [...(input.watchedAssetIds ?? [])],
    unlockedEndingIds: [...(input.unlockedEndingIds ?? [])],
    completedEndingIds: [...(input.completedEndingIds ?? [])],
    deterministicRuntime: cloneDeterministicRuntime(input.deterministicRuntime),
  };
}

export function dispatchExperienceEvent(
  manifest: ExperienceRuntimeManifest,
  currentState: ExperienceRuntimeState,
  event: ExperienceRuntimeEvent,
  canAccess?: ExperienceAccessCheck
): ExperienceDispatchResult {
  if (currentState.status === "completed") {
    return { state: currentState, handled: false, effects: [] };
  }
  const node = manifest.graph.nodes.find(
    (candidate) => candidate.sceneId === currentState.currentSceneId
  );
  if (!node) {
    throw new ExperienceRuntimeInvariantError(
      "CURRENT_SCENE_MISSING",
      `Current scene ${currentState.currentSceneId} is absent from the manifest`
    );
  }
  const effects: ExperienceRuntimeEffect[] = [];
  requireAccess(node.access, canAccess, { kind: "node", sceneId: node.sceneId }, effects);
  const matchingBindings = node.eventBindings.filter((binding) => selectorMatches(binding, event));
  if (matchingBindings.length > 1) {
    throw new ExperienceRuntimeInvariantError(
      "AMBIGUOUS_EVENT_BINDING",
      `Event ${event.type} matches multiple bindings in scene ${node.sceneId}`
    );
  }
  const binding = matchingBindings[0];
  if (!binding) return { state: currentState, handled: false, effects };

  const route = binding.routes.find(
    (candidate) =>
      !candidate.when || evaluateExperienceCondition(candidate.when, currentState, event)
  );
  if (!route) {
    return {
      state: currentState,
      handled: true,
      bindingId: binding.bindingId,
      effects,
    };
  }

  requireAccess(
    route.access,
    canAccess,
    { kind: "route", sceneId: node.sceneId, bindingId: binding.bindingId, routeId: route.routeId },
    effects
  );
  const state = cloneRuntimeState(currentState);
  for (const action of route.actions) {
    applyAction(
      manifest,
      node,
      state,
      event,
      action,
      effects,
      binding.bindingId,
      route.routeId,
      canAccess
    );
  }
  return {
    state,
    handled: true,
    bindingId: binding.bindingId,
    routeId: route.routeId,
    effects,
  };
}

/**
 * Canonical event orchestration for Web and Studio. Emitted semantic events are
 * drained here so hosts cannot accidentally implement different recursion or
 * ordering rules.
 */
export function runExperienceEventQueue(
  manifest: ExperienceRuntimeManifest,
  currentState: ExperienceRuntimeState,
  initialEvents: readonly ExperienceRuntimeEvent[],
  options: { maxProcessedEvents?: number; canAccess?: ExperienceAccessCheck } = {}
): ExperienceEventQueueResult {
  const maxProcessedEvents = options.maxProcessedEvents ?? 256;
  if (!Number.isInteger(maxProcessedEvents) || maxProcessedEvents <= 0) {
    throw new RangeError("maxProcessedEvents must be a positive integer");
  }
  const pending = initialEvents.map((event) => structuredClone(event));
  const effects: ExperienceRuntimeEffect[] = [];
  let state = currentState;
  let processedEventCount = 0;
  while (pending.length > 0) {
    if (processedEventCount >= maxProcessedEvents) {
      throw new ExperienceRuntimeInvariantError(
        "EVENT_QUEUE_BUDGET_EXCEEDED",
        `Experience event queue exceeded ${maxProcessedEvents} events`
      );
    }
    const event = pending.shift() as ExperienceRuntimeEvent;
    processedEventCount += 1;
    const result = dispatchExperienceEvent(manifest, state, event, options.canAccess);
    state = result.state;
    result.effects.forEach((effect) => {
      if (effect.kind === "event.emit") {
        pending.push({
          type: effect.eventType,
          ...(effect.sourceId ? { sourceId: effect.sourceId } : {}),
          ...(effect.qualifierId ? { qualifierId: effect.qualifierId } : {}),
          payload: structuredClone(effect.payload),
        });
        return;
      }
      effects.push(effect);
      if (effect.kind === "scene.changed") {
        pending.push({
          type: "scene.entered",
          sourceId: effect.toSceneId,
          payload: { fromSceneId: effect.fromSceneId },
        });
      }
    });
  }
  return { state, effects, processedEventCount };
}

export function evaluateExperienceCondition(
  condition: ExperienceCondition,
  state: ExperienceRuntimeState,
  event: ExperienceRuntimeEvent
): boolean {
  if (condition.kind === "all") {
    return condition.conditions.every((child) => evaluateExperienceCondition(child, state, event));
  }
  if (condition.kind === "any") {
    return condition.conditions.some((child) => evaluateExperienceCondition(child, state, event));
  }
  if (condition.kind === "not") {
    return !evaluateExperienceCondition(condition.condition, state, event);
  }
  if (condition.kind === "exists") {
    return resolveValue(condition.value, state, event) !== undefined;
  }

  const left = resolveValue(condition.left, state, event);
  const right = resolveValue(condition.right, state, event);
  switch (condition.operator) {
    case "equals":
      return deepEqual(left, right);
    case "not-equals":
      return !deepEqual(left, right);
    case "greater-than":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "at-least":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "less-than":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "at-most":
      return typeof left === "number" && typeof right === "number" && left <= right;
    case "contains":
      if (typeof left === "string" && typeof right === "string") return left.includes(right);
      if (Array.isArray(left)) return left.some((entry) => deepEqual(entry, right));
      if (isJsonObject(left) && typeof right === "string") {
        return Object.prototype.hasOwnProperty.call(left, right);
      }
      return false;
  }
}

export function isExperienceRendererVisible(
  manifest: ExperienceRuntimeManifest,
  state: ExperienceRuntimeState,
  rendererInstanceId: string,
  event: ExperienceRuntimeEvent = { type: "runtime.visibility" }
): boolean {
  const node = manifest.graph.nodes.find((candidate) => candidate.sceneId === state.currentSceneId);
  if (!node || node.kind !== "scene") return false;
  const renderer = node.renderers.find((candidate) => candidate.instanceId === rendererInstanceId);
  if (!renderer) return false;
  return renderer.visibleWhen
    ? evaluateExperienceCondition(renderer.visibleWhen, state, event)
    : true;
}

function selectorMatches(binding: ExperienceEventBinding, event: ExperienceRuntimeEvent): boolean {
  if (binding.on.type !== event.type) return false;
  if (binding.on.sourceId !== undefined && binding.on.sourceId !== event.sourceId) return false;
  return !(binding.on.qualifierId !== undefined && binding.on.qualifierId !== event.qualifierId);
}

function applyAction(
  manifest: ExperienceRuntimeManifest,
  node: ExperienceGraphNode,
  state: ExperienceRuntimeState,
  event: ExperienceRuntimeEvent,
  action: ExperienceRuntimeAction,
  effects: ExperienceRuntimeEffect[],
  bindingId: string,
  routeId: string,
  canAccess?: ExperienceAccessCheck
): void {
  switch (action.kind) {
    case "state.set": {
      const value = resolveValue(action.value, state, event);
      if (value === undefined) {
        throw new ExperienceRuntimeInvariantError(
          "STATE_VALUE_UNDEFINED",
          `state.set ${action.path} resolved to undefined`
        );
      }
      writeStateValue(manifest.stateDefinitions, state.values, action.path, value);
      return;
    }
    case "state.increment": {
      const amount = resolveValue(action.amount, state, event);
      const current = readStateValue(state.values, action.path);
      if (typeof current !== "number" || typeof amount !== "number") {
        throw new ExperienceRuntimeInvariantError(
          "STATE_INCREMENT_TYPE",
          `state.increment ${action.path} requires numeric state and amount`
        );
      }
      writeStateValue(manifest.stateDefinitions, state.values, action.path, current + amount);
      return;
    }
    case "scene.goto": {
      requireAccess(
        manifest.graph.nodes.find((candidate) => candidate.sceneId === action.sceneId)?.access,
        canAccess,
        { kind: "node", sceneId: action.sceneId },
        effects
      );
      const fromSceneId = state.currentSceneId;
      state.currentSceneId = action.sceneId;
      state.values.scene = createInitialStateBucket(manifest.stateDefinitions, "scene");
      effects.push({
        kind: "scene.changed",
        fromSceneId,
        toSceneId: action.sceneId,
        bindingId,
        routeId,
      });
      return;
    }
    case "ending.complete": {
      state.status = "completed";
      state.completedEndingId = action.endingId;
      state.completedEndingIds = addUnique(state.completedEndingIds, action.endingId);
      effects.push({
        kind: "ending.completed",
        fromSceneId: state.currentSceneId,
        endingId: action.endingId,
        bindingId,
        routeId,
      });
      return;
    }
    case "renderer.command":
      effects.push({
        kind: action.kind,
        instanceId: action.instanceId,
        commandType: action.commandType,
        payload: resolvePayload(action.payload, state, event),
      });
      return;
    case "audio.play":
      const playback = resolveExperienceAudioPlayback(
        manifest,
        state.deterministicRuntime,
        action.cueId
      );
      effects.push({
        kind: action.kind,
        cueId: action.cueId,
        assetId: playback.assetId,
        playbackRate: playback.playbackRate,
        playbackOrdinal: playback.playbackOrdinal,
        ...(action.playbackId ? { playbackId: action.playbackId } : {}),
      });
      return;
    case "audio.stop":
      effects.push({
        kind: action.kind,
        target: action.target,
        targetId: action.targetId,
        ...(action.fadeOutMs !== undefined ? { fadeOutMs: action.fadeOutMs } : {}),
      });
      return;
    case "audio.fade-bus":
      effects.push({ ...action });
      return;
    case "audio.apply-snapshot":
      effects.push({ ...action });
      return;
    case "event.emit":
      effects.push({
        kind: action.kind,
        eventType: action.eventType,
        ...(action.sourceId ? { sourceId: action.sourceId } : {}),
        ...(action.qualifierId ? { qualifierId: action.qualifierId } : {}),
        payload: resolvePayload(action.payload, state, event),
      });
      return;
    case "telemetry.emit":
      effects.push({
        kind: action.kind,
        eventName: action.eventName,
        payload: resolvePayload(action.payload, state, event),
      });
      return;
    case "progress.mark-asset-watched":
      state.watchedAssetIds = addUnique(state.watchedAssetIds, action.assetId);
      return;
    case "progress.unlock-ending":
      state.unlockedEndingIds = addUnique(state.unlockedEndingIds, action.endingId);
      return;
    case "session.checkpoint":
      effects.push({ kind: action.kind, checkpointId: action.checkpointId });
      return;
  }
}

function resolvePayload(
  payload: Record<string, ExperienceValueExpression>,
  state: ExperienceRuntimeState,
  event: ExperienceRuntimeEvent
): ExperienceJsonObject {
  return Object.fromEntries(
    Object.entries(payload).map(([key, expression]) => {
      const value = resolveValue(expression, state, event);
      if (value === undefined) {
        throw new ExperienceRuntimeInvariantError(
          "PAYLOAD_VALUE_UNDEFINED",
          `Payload field ${key} resolved to undefined`
        );
      }
      return [key, structuredClone(value)];
    })
  );
}

function resolveValue(
  expression: ExperienceValueExpression,
  state: ExperienceRuntimeState,
  event: ExperienceRuntimeEvent
): ExperienceJsonValue | undefined {
  if (expression.kind === "literal") return structuredClone(expression.value);
  if (expression.kind === "state") return readStateValue(state.values, expression.path);
  if (expression.kind === "event") return readObjectPath(event.payload ?? {}, expression.path);
  return readObjectPath(event.context ?? {}, expression.path);
}

function readStateValue(
  values: ExperienceScopedStateSnapshot,
  path: string
): ExperienceJsonValue | undefined {
  assertSafeRuntimePath(path);
  for (const scope of STATE_SCOPES) {
    const bucket = values[scope];
    if (Object.prototype.hasOwnProperty.call(bucket, path)) return bucket[path];
    const segments = path.split(".");
    for (let index = segments.length - 1; index > 0; index -= 1) {
      const rootPath = segments.slice(0, index).join(".");
      if (!Object.prototype.hasOwnProperty.call(bucket, rootPath)) continue;
      return readObjectPath(bucket[rootPath], segments.slice(index).join("."));
    }
  }
  return undefined;
}

function writeStateValue(
  definitions: readonly ExperienceStateDefinition[],
  values: ExperienceScopedStateSnapshot,
  path: string,
  value: ExperienceJsonValue
): void {
  assertSafeRuntimePath(path);
  const exact = definitions.find((definition) => definition.key === path);
  if (exact) {
    assertStateValue(exact, value);
    values[exact.scope][path] = structuredClone(value);
    return;
  }
  const root = definitions
    .filter(
      (definition) => definition.valueType === "json" && path.startsWith(`${definition.key}.`)
    )
    .sort((left, right) => right.key.length - left.key.length)[0];
  if (!root) {
    throw new ExperienceRuntimeInvariantError("STATE_PATH_UNKNOWN", `Unknown state path ${path}`);
  }
  const bucket = values[root.scope];
  const existing = bucket[root.key];
  if (!isJsonObject(existing)) {
    throw new ExperienceRuntimeInvariantError(
      "STATE_JSON_ROOT_INVALID",
      `JSON state root ${root.key} is not an object`
    );
  }
  const cloned = structuredClone(existing);
  writeObjectPath(cloned, path.slice(root.key.length + 1), structuredClone(value));
  assertStateValue(root, cloned);
  bucket[root.key] = cloned;
}

function assertStateValue(definition: ExperienceStateDefinition, value: ExperienceJsonValue): void {
  const typeMatches =
    definition.valueType === "json" ? isJsonObject(value) : typeof value === definition.valueType;
  if (!typeMatches) {
    throw new ExperienceRuntimeInvariantError(
      "STATE_VALUE_TYPE",
      `${definition.key} requires ${definition.valueType}`
    );
  }
  const constraints = definition.constraints;
  if (!constraints) return;
  if (typeof value === "number") {
    if (constraints.minimum !== undefined && value < constraints.minimum) {
      throw new ExperienceRuntimeInvariantError(
        "STATE_VALUE_MINIMUM",
        `${definition.key} must be at least ${constraints.minimum}`
      );
    }
    if (constraints.maximum !== undefined && value > constraints.maximum) {
      throw new ExperienceRuntimeInvariantError(
        "STATE_VALUE_MAXIMUM",
        `${definition.key} must be at most ${constraints.maximum}`
      );
    }
  }
  if (typeof value === "string") {
    if (constraints.minLength !== undefined && value.length < constraints.minLength) {
      throw new ExperienceRuntimeInvariantError(
        "STATE_VALUE_MIN_LENGTH",
        `${definition.key} must contain at least ${constraints.minLength} characters`
      );
    }
    if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
      throw new ExperienceRuntimeInvariantError(
        "STATE_VALUE_MAX_LENGTH",
        `${definition.key} must contain at most ${constraints.maxLength} characters`
      );
    }
  }
  if (
    constraints.allowedValues &&
    !constraints.allowedValues.some((allowed) => deepEqual(allowed, value))
  ) {
    throw new ExperienceRuntimeInvariantError(
      "STATE_VALUE_NOT_ALLOWED",
      `${definition.key} received a value outside its allowed set`
    );
  }
}

function readObjectPath(
  root: ExperienceJsonValue | undefined,
  path: string
): ExperienceJsonValue | undefined {
  if (!path) return root;
  let current: ExperienceJsonValue | undefined = root;
  for (const segment of path.split(".")) {
    if (RESERVED_PATH_SEGMENTS.has(segment)) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!isJsonObject(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function writeObjectPath(
  root: ExperienceJsonObject,
  path: string,
  value: ExperienceJsonValue
): void {
  const segments = path.split(".");
  let current = root;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const existing = Object.prototype.hasOwnProperty.call(current, segment)
      ? current[segment]
      : undefined;
    if (isJsonObject(existing)) {
      current = existing;
      return;
    }
    if (existing !== undefined) {
      throw new ExperienceRuntimeInvariantError(
        "STATE_PATH_CONFLICT",
        `Cannot create object path through non-object segment ${segment}`
      );
    }
    const next = Object.create(null) as ExperienceJsonObject;
    current[segment] = next;
    current = next;
  });
}

function cloneRuntimeState(state: ExperienceRuntimeState): ExperienceRuntimeState {
  return {
    ...state,
    values: cloneScopedState(state.values),
    watchedAssetIds: [...state.watchedAssetIds],
    unlockedEndingIds: [...state.unlockedEndingIds],
    completedEndingIds: [...state.completedEndingIds],
    deterministicRuntime: cloneDeterministicRuntime(state.deterministicRuntime),
  };
}

function cloneDeterministicRuntime(
  state: ExperienceDeterministicRuntimeState
): ExperienceDeterministicRuntimeState {
  return {
    ...(state.randomSeed ? { randomSeed: state.randomSeed } : {}),
    audioCuePlayCounts: { ...state.audioCuePlayCounts },
  };
}

const STATE_SCOPES = [
  "session",
  "player",
  "scene",
] as const satisfies readonly ExperienceStateScope[];
const RESERVED_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function createStateBucket(): Record<string, ExperienceJsonValue> {
  return Object.create(null) as Record<string, ExperienceJsonValue>;
}

function createEmptyScopedState(): ExperienceScopedStateSnapshot {
  return {
    session: createStateBucket(),
    player: createStateBucket(),
    scene: createStateBucket(),
  };
}

function createInitialStateBucket(
  definitions: readonly ExperienceStateDefinition[],
  scope: ExperienceStateScope
): Record<string, ExperienceJsonValue> {
  const bucket = createStateBucket();
  definitions.forEach((definition) => {
    if (definition.scope !== scope) return;
    assertStateValue(definition, definition.initialValue);
    bucket[definition.key] = structuredClone(definition.initialValue);
  });
  return bucket;
}

function createInitialScopedState(
  definitions: readonly ExperienceStateDefinition[]
): ExperienceScopedStateSnapshot {
  return {
    session: createInitialStateBucket(definitions, "session"),
    player: createInitialStateBucket(definitions, "player"),
    scene: createInitialStateBucket(definitions, "scene"),
  };
}

function cloneStateBucket(
  bucket: Readonly<Record<string, ExperienceJsonValue>>
): Record<string, ExperienceJsonValue> {
  const clone = createStateBucket();
  Object.entries(bucket).forEach(([key, value]) => {
    clone[key] = structuredClone(value);
  });
  return clone;
}

function cloneScopedState(values: ExperienceScopedStateSnapshot): ExperienceScopedStateSnapshot {
  return {
    session: cloneStateBucket(values.session),
    player: cloneStateBucket(values.player),
    scene: cloneStateBucket(values.scene),
  };
}

function assertSafeRuntimePath(path: string): void {
  if (path.split(".").some((segment) => RESERVED_PATH_SEGMENTS.has(segment))) {
    throw new ExperienceRuntimeInvariantError(
      "STATE_PATH_RESERVED",
      `State path ${path} contains a reserved segment`
    );
  }
}

function addUnique(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}

function isJsonObject(value: unknown): value is ExperienceJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (isJsonObject(left) && isJsonObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]))
    );
  }
  return false;
}
