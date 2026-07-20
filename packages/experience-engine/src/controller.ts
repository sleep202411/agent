import type {
  ExperienceJsonObject,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import {
  assertExperienceRuntimeCompatibility,
  type ExperienceRuntimeHostCompatibility,
} from "./compatibility.js";
import { ExperienceRendererRegistry } from "./renderer-registry.js";
import {
  ExperienceRuntimeInvariantError,
  initializeExperienceRuntime,
  restoreExperienceRuntime,
  runExperienceEventQueue,
  type ExperienceEventQueueResult,
  type ExperienceRuntimeEvent,
  type ExperienceRuntimeRestoreInput,
  type ExperienceRuntimeState,
} from "./runtime.js";

export interface ExperienceRuntimeControllerOptions {
  compatibility: ExperienceRuntimeHostCompatibility;
  rendererRegistry: ExperienceRendererRegistry;
  randomSeed?: string;
  restore?: ExperienceRuntimeRestoreInput;
}

/**
 * One host-independent control boundary used by Studio Preview and Web. It
 * validates compatibility and renderer adapters before the first scene can
 * run, owns event queue ordering, and validates renderer I/O at the boundary.
 */
export class ExperienceRuntimeController {
  readonly #manifest: ExperienceRuntimeManifest;
  readonly #rendererRegistry: ExperienceRendererRegistry;
  #state: ExperienceRuntimeState;
  #started: boolean;

  constructor(manifest: ExperienceRuntimeManifest, options: ExperienceRuntimeControllerOptions) {
    assertExperienceRuntimeCompatibility(manifest, options.compatibility);
    options.rendererRegistry.assertManifest(manifest);
    this.#manifest = manifest;
    this.#rendererRegistry = options.rendererRegistry;
    this.#state = options.restore
      ? restoreExperienceRuntime(manifest, options.restore)
      : initializeExperienceRuntime(manifest, { randomSeed: options.randomSeed });
    this.#started = Boolean(options.restore);
  }

  state(): ExperienceRuntimeState {
    return structuredClone(this.#state);
  }

  /**
   * Activates a fresh runtime exactly once and settles entry routers through
   * the canonical event queue. Restored sessions are already active and must
   * not replay scene-entry actions.
   */
  start(): ExperienceEventQueueResult {
    if (this.#started) {
      throw new ExperienceRuntimeInvariantError(
        "RUNTIME_ALREADY_STARTED",
        "Experience runtime has already started"
      );
    }
    this.#started = true;
    return this.dispatch([
      {
        type: "scene.entered",
        sourceId: this.#state.currentSceneId,
        payload: {},
      },
    ]);
  }

  dispatch(
    events: readonly ExperienceRuntimeEvent[],
    options?: { maxProcessedEvents?: number }
  ): ExperienceEventQueueResult {
    const result = runExperienceEventQueue(this.#manifest, this.#state, events, options);
    result.effects.forEach((effect) => {
      if (effect.kind !== "renderer.command") return;
      const instance = this.#manifest.graph.nodes
        .flatMap((node) => (node.kind === "scene" ? node.renderers : []))
        .find((candidate) => candidate.instanceId === effect.instanceId);
      if (!instance) {
        throw new ExperienceRuntimeInvariantError(
          "RENDERER_INSTANCE_UNKNOWN",
          `Renderer command targets unknown instance ${effect.instanceId}`
        );
      }
      this.#rendererRegistry
        .require(instance.rendererId)
        .assertCommand(effect.commandType, effect.payload);
    });
    this.#state = result.state;
    return {
      ...result,
      state: structuredClone(result.state),
      effects: structuredClone(result.effects),
    };
  }

  emitRendererOutcome(input: {
    instanceId: string;
    outcomeType: string;
    payload?: ExperienceJsonObject;
  }): ExperienceEventQueueResult {
    const scene = this.#manifest.graph.nodes.find(
      (node) => node.sceneId === this.#state.currentSceneId
    );
    if (!scene || scene.kind !== "scene") {
      throw new ExperienceRuntimeInvariantError(
        "CURRENT_SCENE_MISSING",
        `Current scene ${this.#state.currentSceneId} is unavailable`
      );
    }
    const instance = scene.renderers.find((candidate) => candidate.instanceId === input.instanceId);
    if (!instance) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_INSTANCE_NOT_ACTIVE",
        `Renderer ${input.instanceId} is not active in ${scene.sceneId}`
      );
    }
    const requirement = this.#manifest.rendererRequirements.find(
      (candidate) => candidate.rendererId === instance.rendererId
    );
    if (!requirement?.outcomes.some((outcome) => outcome.outcomeType === input.outcomeType)) {
      throw new ExperienceRuntimeInvariantError(
        "RENDERER_OUTCOME_UNDECLARED",
        `Renderer ${instance.rendererId} did not declare outcome ${input.outcomeType}`
      );
    }
    const payload = structuredClone(input.payload ?? {});
    this.#rendererRegistry.require(instance.rendererId).assertOutcome(input.outcomeType, payload);
    return this.dispatch([
      {
        type: "renderer.outcome",
        sourceId: input.instanceId,
        qualifierId: input.outcomeType,
        payload,
      },
    ]);
  }
}
