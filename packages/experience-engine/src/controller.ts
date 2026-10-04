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
  #reporting: Promise<void> = Promise.resolve();
  #reportingStarted = false;
  #reportEpoch = 0;
  #completedPlaySessionId: string | null = null;
  #reportError: string | null = null;
  #retryReport: (() => Promise<void>) | null = null;
  getPlaySessionReportError = (): string | null => this.#reportError;
  retryPlaySessionReport = (): void => {
    void this.#retryReport?.();
  };
  #reportListeners = new Set<() => void>();

  getCompletedPlaySessionId = (): string | null => this.#completedPlaySessionId;

  subscribePlaySessionReport = (listener: () => void): (() => void) => {
    this.#reportListeners.add(listener);
    return () => {
      this.#reportListeners.delete(listener);
    };
  };
  #visitedNodeIds = new Set<string>();

  get playSessionId(): string | null {
    return this.#playSessionId;
  }

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

    // A controller owns one play. Never reuse a completed or another viewer's
    // report session merely because the film/build matches browser storage.
  }

  state(): ExperienceRuntimeState {
    return structuredClone(this.#state);
  }

  /** Rewind to accepted entry state without replaying scene-entry actions. */
  restore(input: ExperienceRuntimeRestoreInput): ExperienceRuntimeState {
    const state = restoreExperienceRuntime(this.#manifest, input);
    const node = this.#manifest.graph.nodes.find(
      (candidate) => candidate.sceneId === state.currentSceneId
    );
    if (node?.access && !this.#canAccess?.(node.access))
      throw new ExperienceAccessRequiredError(node.access);
    this.#state = state;
    this.#started = true;
    // Old async report completions belong to the previous branch. A rewound
    // branch starts a new report session on its first accepted event.
    this.#reportEpoch++;
    this.#reporting = Promise.resolve();
    this.#reportingStarted = false;
    this.#playSessionId = null;
    this.#completedPlaySessionId = null;
    this.#reportError = null;
    this.#retryReport = null;
    this.#visitedNodeIds.clear();
    this.#reportListeners.forEach((listener) => listener());
    return this.state();
  }

  #handleReporterFailure(err: unknown, context: string): void {
    console.warn(`[ExperienceRuntimeController] Play session ${context} failed:`, err);
  }

  #startReporting(): void {
    if (this.#reportingStarted || !this.#reporter) return;
    this.#reportingStarted = true;
    const epoch = this.#reportEpoch;
    this.#reporting = (async () => {
      try {
        const result = await this.#reporter!.onStart({
          gameId: this.#manifest.gameId,
          contentVersion: this.#manifest.contentVersion,
          buildId: this.#manifest.buildId,
          locale: this.#manifest.localization?.defaultLocale,
          experienceType: "film",
        });
        if (epoch === this.#reportEpoch) this.#playSessionId = result?.sessionId ?? null;
      } catch (error) {
        this.#handleReporterFailure(error, "onStart");
      }
    })();
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
    // Restored access checkpoints also need a transport-owned report session.
    // Start only after the runtime has accepted the events.
    this.#startReporting();
    const epoch = this.#reportEpoch;
    result.effects.forEach((effect) => {
      if (effect.kind === "scene.changed") {
        if (this.#reporter) {
          if (!this.#visitedNodeIds.has(effect.toSceneId)) {
            this.#visitedNodeIds.add(effect.toSceneId);
            const currentNode = effect.toSceneId;
            this.#reporting = this.#reporting.then(async () => {
              if (epoch !== this.#reportEpoch) return;
              const sessionId = this.#playSessionId;
              if (!sessionId) return;
              try {
                await this.#reporter!.onProgress(sessionId, { currentNode });
              } catch (err) {
                this.#handleReporterFailure(err, "onProgress (scene.changed)");
              }
            });
          }
        }
      } else if (effect.kind === "ending.completed") {
        if (this.#reporter) {
          const endingId = effect.endingId;
          const currentNode = result.state.currentSceneId;
          this.#reporting = this.#reporting.then(async () => {
            if (epoch !== this.#reportEpoch) return;
            const sessionId = this.#playSessionId;
            if (!sessionId) return;
            const save = async (): Promise<void> => {
              if (epoch !== this.#reportEpoch) return;
              this.#retryReport = null;
              const clearingError = this.#reportError !== null;
              this.#reportError = null;
              if (clearingError) this.#reportListeners.forEach((listener) => listener());
              try {
                await this.#reporter!.onComplete(sessionId, { endingId, currentNode });
                if (epoch !== this.#reportEpoch) return;
                this.#completedPlaySessionId = sessionId;
              } catch (err) {
                if (epoch !== this.#reportEpoch) return;
                this.#reportError = err instanceof Error ? err.message : String(err);
                this.#retryReport = save;
                this.#handleReporterFailure(err, "onComplete");
              }
              this.#reportListeners.forEach((listener) => listener());
            };
            await save();
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

    if (input.outcomeType === "choice-selected" && this.#reporter) {
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
          const currentNode = this.#state.currentSceneId;
          const epoch = this.#reportEpoch;
          this.#reporting = this.#reporting.then(async () => {
            if (epoch !== this.#reportEpoch) return;
            const sessionId = this.#playSessionId;
            if (!sessionId) return;
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
              this.#handleReporterFailure(err, "onProgress (choice)");
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
