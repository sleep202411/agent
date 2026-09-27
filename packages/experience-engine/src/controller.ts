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
  ExperienceAccessRequiredError,
  initializeExperienceRuntime,
  restoreExperienceRuntime,
  runExperienceEventQueue,
  type ExperienceAccessCheck,
  type ExperienceEventQueueResult,
  type ExperienceRuntimeEvent,
  type ExperienceRuntimeRestoreInput,
  type ExperienceRuntimeState,
} from "./runtime.js";
import type { PlaySessionReporter } from "./play-session-reporter.js";

export interface ExperienceRuntimeControllerOptions {
  compatibility: ExperienceRuntimeHostCompatibility;
  rendererRegistry: ExperienceRendererRegistry;
  randomSeed?: string;
  restore?: ExperienceRuntimeRestoreInput;
  canAccess?: ExperienceAccessCheck;
  playSessionReporter?: PlaySessionReporter;
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
  readonly #canAccess?: ExperienceAccessCheck;
  readonly #reporter?: PlaySessionReporter;
  #playSessionId: string | null = null;

  constructor(manifest: ExperienceRuntimeManifest, options: ExperienceRuntimeControllerOptions) {
    assertExperienceRuntimeCompatibility(manifest, options.compatibility);
    options.rendererRegistry.assertManifest(manifest);
    this.#manifest = manifest;
    this.#canAccess = options.canAccess;
    this.#rendererRegistry = options.rendererRegistry;
    this.#reporter = options.playSessionReporter;
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

    // Fire-and-forget session start
    if (this.#reporter) {
      void (async () => {
        try {
          const res = await this.#reporter!.onStart({
            gameId: this.#manifest.gameId,
            contentVersion: this.#manifest.contentVersion,
            buildId: this.#manifest.buildId,
            locale: this.#manifest.localization?.defaultLocale,
            experienceType: "film",
          });
          if (res?.sessionId) {
            this.#playSessionId = res.sessionId;
          }
        } catch (err) {
          console.warn("[ExperienceRuntimeController] Play session onStart failed:", err);
        }
      })();
    }

    try {
      return this.dispatch([
        {
          type: "scene.entered",
          sourceId: this.#state.currentSceneId,
          payload: {},
        },
      ]);
    } catch (error) {
      this.#started = false;
      throw error;
    }
  }

  dispatch(
    events: readonly ExperienceRuntimeEvent[],
    options?: { maxProcessedEvents?: number }
  ): ExperienceEventQueueResult {
    this.#assertStarted();
    let result: ExperienceEventQueueResult;
    try {
      result = runExperienceEventQueue(this.#manifest, this.#state, events, {
        ...options,
        canAccess: this.#canAccess,
      });
    } catch (error) {
      if (error instanceof ExperienceAccessRequiredError)
        error.events = structuredClone([...events]);
      throw error;
    }
    result.effects.forEach((effect) => {
      if (effect.kind === "scene.changed") {
        if (this.#reporter && this.#playSessionId) {
          const sessionId = this.#playSessionId;
          const currentNode = effect.toSceneId;
          void Promise.resolve().then(async () => {
            try {
              await this.#reporter!.onProgress(sessionId, { currentNode });
            } catch (err) {
              console.warn(
                "[ExperienceRuntimeController] Play session onProgress (scene.changed) failed:",
                err
              );
            }
          });
        }
      } else if (effect.kind === "ending.completed") {
        if (this.#reporter && this.#playSessionId) {
          const sessionId = this.#playSessionId;
          const endingId = effect.endingId;
          const currentNode = this.#state.currentSceneId;
          void Promise.resolve().then(async () => {
            try {
              await this.#reporter!.onComplete(sessionId, { endingId, currentNode });
            } catch (err) {
              console.warn("[ExperienceRuntimeController] Play session onComplete failed:", err);
            }
          });
        }
      } else if (effect.kind === "renderer.command") {
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
      }
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
    this.#assertStarted();
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

    if (input.outcomeType === "choice-selected" && this.#reporter && this.#playSessionId) {
      const choiceId = (payload as any)?.choiceId;
      if (choiceId && typeof choiceId === "string") {
        const config = instance.config as any;
        const choices = Array.isArray(config?.choices) ? config.choices : [];
        const matchedChoice = choices.find((c: any) => c.choiceId === choiceId);
        const decisionId = config?.decisionId || instance.instanceId;
        if (matchedChoice) {
          const rawLabel = matchedChoice.label;
          const defaultLoc = this.#manifest.localization?.defaultLocale ?? "zh-CN";
          const label =
            typeof rawLabel === "string"
              ? rawLabel
              : rawLabel?.[defaultLoc] || Object.values(rawLabel || {})[0] || choiceId;
          const sessionId = this.#playSessionId;
          const currentNode = this.#state.currentSceneId;
          void Promise.resolve().then(async () => {
            try {
              await this.#reporter!.onProgress(sessionId, {
                currentNode,
                choice: {
                  optionId: choiceId,
                  label: String(label),
                  decisionId: String(decisionId),
                },
              });
            } catch (err) {
              console.warn(
                "[ExperienceRuntimeController] Play session onProgress (choice) failed:",
                err
              );
            }
          });
        } else {
          console.warn(
            `[ExperienceRuntimeController] Choice ${choiceId} not found in instance ${instance.instanceId}`
          );
        }
      }
    }

    return this.dispatch([
      {
        type: "renderer.outcome",
        sourceId: input.instanceId,
        qualifierId: input.outcomeType,
        payload,
      },
    ]);
  }

  #assertStarted(): void {
    if (this.#started) return;
    throw new ExperienceRuntimeInvariantError(
      "RUNTIME_NOT_STARTED",
      "Experience runtime must be started before it can process input"
    );
  }
}
