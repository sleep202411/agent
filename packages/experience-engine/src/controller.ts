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

    // Phase 1b: restore a persisted sessionId across page refreshes (browser only).
    try {
      if (typeof sessionStorage !== "undefined") {
        const stored = sessionStorage.getItem(this.#sessionStorageKey());
        if (stored) this.#playSessionId = stored;

        const storedVisited = sessionStorage.getItem(this.#visitedStorageKey());
        if (storedVisited) {
          const parsed = JSON.parse(storedVisited);
          if (Array.isArray(parsed)) {
            parsed.forEach((id) => {
              if (typeof id === "string") this.#visitedNodeIds.add(id);
            });
          }
        }
      }
    } catch {
      // SSR or private mode — ignore.
    }
  }

  state(): ExperienceRuntimeState {
    return structuredClone(this.#state);
  }

  /**
   * Phase 1b: sessionStorage key for the current film build. A new build or
   * film gets a fresh key, so restored sessions never cross film boundaries.
   */
  #sessionStorageKey(): string {
    return `play_session:${this.#manifest.gameId}:${this.#manifest.buildId}`;
  }

  #visitedStorageKey(): string {
    return `play_session_visited:${this.#manifest.gameId}:${this.#manifest.buildId}`;
  }

  /**
   * Phase 1b: on reporter failure, clear the persisted sessionId when the
   * backend reports the session is gone (404/410), so the next start() will
   * create a fresh session instead of silently no-op'ing forever.
   */
  #handleReporterFailure(err: unknown, context: string): void {
    console.warn(`[ExperienceRuntimeController] Play session ${context} failed:`, err);
    const e = err as {
      status?: number;
      statusCode?: number;
      response?: { status?: number };
    };
    const status = e?.status ?? e?.statusCode ?? e?.response?.status;
    if (status === 404 || status === 410) {
      this.#playSessionId = null;
      this.#visitedNodeIds.clear();
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem(this.#sessionStorageKey());
          sessionStorage.removeItem(this.#visitedStorageKey());
        }
      } catch {
        // ignore
      }
      console.warn(
        "[ExperienceRuntimeController] Play session no longer valid, will restart on next start()"
      );
    }
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

    // Fire-and-forget session start — skipped if a sessionId was restored.
    if (this.#reporter && !this.#playSessionId) {
      this.#reporting = (async () => {
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
            try {
              if (typeof sessionStorage !== "undefined") {
                sessionStorage.setItem(this.#sessionStorageKey(), res.sessionId);
              }
            } catch {
              // ignore
            }
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
        if (this.#reporter) {
          if (!this.#visitedNodeIds.has(effect.toSceneId)) {
            this.#visitedNodeIds.add(effect.toSceneId);
            try {
              if (typeof sessionStorage !== "undefined") {
                sessionStorage.setItem(
                  this.#visitedStorageKey(),
                  JSON.stringify([...this.#visitedNodeIds])
                );
              }
            } catch {
              // ignore
            }
            const currentNode = effect.toSceneId;
            this.#reporting = this.#reporting.then(async () => {
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
            const sessionId = this.#playSessionId;
            if (!sessionId) return;
            try {
              await this.#reporter!.onComplete(sessionId, { endingId, currentNode });
            } catch (err) {
              this.#handleReporterFailure(err, "onComplete");
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
          this.#reporting = this.#reporting.then(async () => {
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
