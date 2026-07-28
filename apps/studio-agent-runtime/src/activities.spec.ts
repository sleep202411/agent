import { ErrorCode } from "@ably/ai-transport";
import { ApplicationFailure, CancelledFailure } from "@temporalio/activity";
import { MockActivityEnvironment } from "@temporalio/testing";
import { DefaultLogger } from "@temporalio/worker";
import * as Ably from "ably";
import { describe, expect, it, vi } from "vitest";
import {
  STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE,
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentActionExecution,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";
import type {
  StudioAgentCloseRunRequest,
  StudioAgentDenyActionRequest,
  StudioAgentExecuteActionRequest,
  StudioAgentOpenRunRequest,
  StudioAgentSuspendRunRequest,
} from "@repo/shared/studio-agent-api";
import { createStudioAgentActivities } from "./activities.js";
import type { StudioAgentDeliveryClient } from "./agent-session.js";
import { RuntimeGatewayHttpError } from "./gateway-client.js";
import type { StudioAgentRuntimeGateway } from "./gateway-client.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const THREAD_ID = "55555555-5555-4555-8555-555555555555";
const POLICY_ID = "66666666-6666-4666-8666-666666666666";
const HASH = "a".repeat(64);

describe("Studio Agent activities", () => {
  it("lets a dispatched transactional action reach canonical completion", async () => {
    const execute = vi.fn(
      async (
        request: StudioAgentExecuteActionRequest,
        signal?: AbortSignal
      ): Promise<StudioAgentActionExecution> => {
        expect(request.actionId).toBe(ACTION_ID);
        expect(signal).toBeInstanceOf(AbortSignal);
        return actionExecution();
      }
    );
    const activities = createStudioAgentActivities({
      gateway: gateway({ executeAction: execute }),
      modelConfig: modelConfig(),
      delivery: deliveryClient(),
    });
    const environment = activityEnvironment();

    await expect(environment.run(activities.executeAction, executeRequest())).resolves.toEqual(
      actionExecution()
    );
    expect(execute).toHaveBeenCalledOnce();
  });

  it("coerces a cancel-time model failure into a Temporal cancellation so steer/stop resumes instead of failing the run", async () => {
    const environment = activityEnvironment();
    const activities = createStudioAgentActivities({
      gateway: gateway({
        loadModelPlan: async () => {
          // steer / stop_and_send cancels the activity; the AI SDK then surfaces
          // the mid-stream abort as an `abort` part that model-runner rethrows
          // as a plain Error.
          environment.cancel();
          await Promise.resolve();
          throw new Error("The model stream was aborted.");
        },
      }),
      modelConfig: modelConfig(),
      delivery: deliveryClient(),
    });

    const failure = await environment
      .run(activities.runModelStep, workflowInput())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CancelledFailure);
  });

  it("propagates a genuine (non-cancellation) model failure unchanged", async () => {
    const environment = activityEnvironment();
    const activities = createStudioAgentActivities({
      gateway: gateway({
        loadModelPlan: async () => {
          throw new Error("provider exploded");
        },
      }),
      modelConfig: modelConfig(),
      delivery: deliveryClient(),
    });

    const failure = await environment
      .run(activities.runModelStep, workflowInput())
      .catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(CancelledFailure);
    expect((failure as Error).message).toContain("provider exploded");
  });

  it("heartbeats independently of model stream cadence so a long time-to-first-token cannot fail the run", async () => {
    vi.useFakeTimers();
    try {
      const environment = activityEnvironment();
      const heartbeats: Array<Record<string, unknown>> = [];
      environment.on("heartbeat", (details) => heartbeats.push(details as Record<string, unknown>));
      let releasePlan!: () => void;
      const planGate = new Promise<void>((resolve) => {
        releasePlan = resolve;
      });
      const activities = createStudioAgentActivities({
        gateway: gateway({
          loadModelPlan: async () => {
            // Simulate the provider not yet returning a first token.
            await planGate;
            throw new Error("end test");
          },
        }),
        modelConfig: modelConfig(),
        delivery: deliveryClient(),
      });

      const run = environment.run(activities.runModelStep, workflowInput()).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(11_000);
      expect(heartbeats).toContainEqual({ phase: "model_step_alive" });
      releasePlan();
      await run;
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks rejected control-plane commands as non-retryable", async () => {
    const activities = createStudioAgentActivities({
      gateway: gateway({
        denyAction: async () => {
          throw new RuntimeGatewayHttpError(422, "invalid action transition");
        },
      }),
      modelConfig: modelConfig(),
      delivery: deliveryClient(),
    });
    const environment = activityEnvironment();

    const failure = await environment
      .run(activities.denyAction, denyRequest())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      type: "studio_agent_gateway_command_rejected",
      nonRetryable: true,
    });
  });
});

function activityEnvironment(info?: { activityId: string }): MockActivityEnvironment {
  return new MockActivityEnvironment(info, {
    logger: new DefaultLogger("ERROR"),
  });
}

interface RecordedStep {
  runId: string;
  stepId: string | undefined;
}

/**
 * A delivery double that records what the model step asked the transport for.
 *
 * Deliberately shallow: the assertion is about the IDENTITY the activity gives
 * its step, which is the thing Temporal and the transport have to agree on. How
 * Ably encodes a chunk is Ably's test suite, not ours.
 */
function recordingDelivery(steps: RecordedStep[]): StudioAgentDeliveryClient {
  return {
    session: async (channelName: string) =>
      ({
        adoptRun: ({ runId }: { runId: string }) => ({
          load: async () => {},
          abortSignal: new AbortController().signal,
          createStep: (options?: { stepId?: string }) => {
            steps.push({ runId, stepId: options?.stepId });
            return {
              start: async () => {},
              pipe: async () => ({ reason: "complete" as const }),
              send: async () => {},
              end: async () => {},
            };
          },
        }),
        channelName,
      }) as never,
    continuityGeneration: () => 0,
    close: () => {},
  };
}

describe("Studio Agent transport step identity", () => {
  /**
   * THE PROPERTY THE WHOLE TEMPORAL/ABLY MARRIAGE RESTS ON.
   *
   * A retry under the SAME `stepId` supersedes the failed attempt's output on
   * the channel; a retry under a fresh one appends BESIDE it, so the user sees
   * the crashed half-answer and the good answer stacked. Temporal keeps
   * `activityId` stable across attempts of one activity, so deriving the step id
   * from it is what makes a cross-process retry idempotent on the wire. Omit the
   * id and the SDK mints a new one — silently, with no error anywhere.
   */
  it("derives a step id that two attempts of the same activity share", async () => {
    const steps: RecordedStep[] = [];
    const activities = createStudioAgentActivities({
      gateway: gateway({
        loadModelPlan: async () => {
          throw new Error("plan unavailable");
        },
      }),
      modelConfig: modelConfig(),
      delivery: recordingDelivery(steps),
    });

    for (const attempt of [1, 2]) {
      void attempt;
      await expect(
        activityEnvironment({ activityId: "4" }).run(activities.runModelStep, deliveredInput())
      ).rejects.toThrow("plan unavailable");
    }

    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step.runId).toBe(RUN_ID);
      // `stepIdFor` is `${invocationId}-${activityId}`, and our workflowId is the
      // RUN id — a deliberate divergence from the library's convention, which
      // assumes workflowId === invocationId. Pinned literally so a "cleanup"
      // that swaps the prefix has to argue with this line.
      expect(step.stepId).toBe(`${RUN_ID}-4`);
    }
  });

  it("opens no transport step for a delegated task run", async () => {
    const steps: RecordedStep[] = [];
    const activities = createStudioAgentActivities({
      gateway: gateway({
        loadModelPlan: async () => {
          throw new Error("plan unavailable");
        },
      }),
      modelConfig: modelConfig(),
      delivery: recordingDelivery(steps),
    });

    await expect(
      activityEnvironment().run(activities.runModelStep, workflowInput())
    ).rejects.toThrow("plan unavailable");

    expect(steps).toEqual([]);
  });
});

function deliveredInput(): StudioAgentWorkflowInput {
  return {
    ...workflowInput(),
    delivery: {
      inputEventId: TRIGGER_EVENT_ID,
      channelName: `studio-agent:thread:${THREAD_ID}`,
    },
  };
}

const TRIGGER_EVENT_ID = "evt-01J000000000000000000000";

function openRequest(
  workflow: StudioAgentWorkflowInput = deliveredInput()
): StudioAgentOpenRunRequest {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    workflow,
    // Non-null: every caller passes a delivered workflow.
    trigger: workflow.delivery!,
  };
}

function suspendRequest(
  workflow: StudioAgentWorkflowInput = deliveredInput()
): StudioAgentSuspendRunRequest {
  return { schemaVersion: STUDIO_AGENT_SCHEMA_VERSION, workflow };
}

function closeRequest(message: string): StudioAgentCloseRunRequest {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    workflow: deliveredInput(),
    reason: "error",
    error: {
      code: "runtime.workflow_failed",
      message,
      retryable: false,
      details: null,
    },
  };
}

interface ColdChannel {
  delivery: StudioAgentDeliveryClient;
  /** Every transport call, in order. The ORDER is the contract under test. */
  trace: string[];
  terminals: Array<{ runId: string; reason: string; errorMessage: string | undefined }>;
  /** Fire the run's transport-level abort, as an `ai-cancel` from the browser does. */
  cancel(): void;
  /** Is the run parked on the channel? What every subscriber reads for liveness. */
  isSuspended(runId?: string): boolean;
  /** Lose channel continuity, which ALSO fires every run's abort. */
  loseContinuity(): void;
}

/**
 * A channel whose triggering `ai-input` is already in HISTORY, not live.
 *
 * This is not a convenience double — it is the library's documented cold-start
 * behaviour, encoded, and it is the only shape in which the production bug is
 * reproducible. `input-event-locator.ts`: "This is a passive watcher — it never
 * pages history itself"; `AgentRun.located`: it resolves "whether by a live
 * arrival or a `run.view.loadOlder()` page the caller drove on a cold start",
 * and "There is no built-in deadline: it never rejects on a timeout".
 *
 * So: `located` here resolves ONLY when the trigger has been folded in by
 * `loadOlder()`. A caller that skips the drain waits forever — exactly as the
 * worker did in production, where the wait ended as a 5-minute Temporal
 * schedule-to-close with nothing on the creator's screen. A mock whose
 * `start()` simply resolves cannot express that, which is why the bug survived
 * a green suite.
 */
function coldChannel(options?: {
  historyEventIds?: string[];
  runStartOnChannel?: boolean;
}): ColdChannel {
  const history = options?.historyEventIds ?? [TRIGGER_EVENT_ID];
  const folded = new Set<string>();
  const suspendedRuns = new Set<string>();
  const waiters: Array<{ eventId: string; resolve: () => void }> = [];
  const openRuns = new Set<string>(options?.runStartOnChannel === false ? [] : [RUN_ID]);
  const controllers: AbortController[] = [];
  const trace: string[] = [];
  const terminals: ColdChannel["terminals"] = [];

  const releaseLocated = (): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!;
      if (folded.has(waiter.eventId)) {
        waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  };
  const locate = (eventId: string): Promise<void> =>
    new Promise<void>((resolve) => {
      if (folded.has(eventId)) {
        resolve();
        return;
      }
      waiters.push({ eventId, resolve });
    });
  const view = () => ({
    hasOlder: () => history.some((eventId) => !folded.has(eventId)),
    loadOlder: async () => {
      trace.push("loadOlder");
      const next = history.find((eventId) => !folded.has(eventId));
      if (next !== undefined) {
        folded.add(next);
        releaseLocated();
      }
      return [];
    },
  });
  let cancelled = false;
  let continuityLosses = 0;
  const controllerFor = (): AbortController => {
    const controller = new AbortController();
    // A cancel that arrived before this run object existed still applies to it:
    // the transport registers a run for cancel routing the moment it is
    // created, and buffers a cancel that raced ahead of the registration.
    if (cancelled) {
      controller.abort();
    }
    controllers.push(controller);
    return controller;
  };
  const endRun = (runId: string) => async (params: { reason: string; error?: Ably.ErrorInfo }) => {
    trace.push(`end:${params.reason}`);
    terminals.push({ runId, reason: params.reason, errorMessage: params.error?.message });
  };

  const session = {
    createRun: (invocation: { inputEventId: string }, runtime: { runId: string }) => {
      trace.push("createRun");
      const controller = controllerFor();
      return {
        runId: runtime.runId,
        abortSignal: controller.signal,
        view: view(),
        start: async () => {
          await locate(invocation.inputEventId);
          // AIT-ST4a: "the cancelled-before-start check precedes the latch".
          if (controller.signal.aborted) {
            throw new Ably.ErrorInfo(
              `unable to start run; run ${runtime.runId} was cancelled before start()`,
              ErrorCode.OperationCancelled,
              400
            );
          }
          trace.push("start");
          openRuns.add(runtime.runId);
        },
        end: endRun(runtime.runId),
      };
    },
    adoptRun: (identity: { runId: string }) => {
      trace.push("adoptRun");
      const controller = controllerFor();
      return {
        runId: identity.runId,
        abortSignal: controller.signal,
        view: view(),
        load: async () => {
          trace.push("load");
          if (!openRuns.has(identity.runId)) {
            throw new Ably.ErrorInfo(
              `unable to load run; run-start for run ${identity.runId} not observed`,
              ErrorCode.InputEventNotFound,
              400
            );
          }
          // The library's own status gate, verbatim in shape: an adopt of a
          // SUSPENDED run is refused with InvalidArgument, which is what makes a
          // retried suspend idempotent rather than fatal.
          if (suspendedRuns.has(identity.runId)) {
            throw new Ably.ErrorInfo(
              `unable to load run; run ${identity.runId} is suspended, resume via createRun().start()`,
              ErrorCode.InvalidArgument,
              400
            );
          }
        },
        suspend: async () => {
          trace.push("suspend");
          suspendedRuns.add(identity.runId);
        },
        createStep: () => ({
          start: async () => {
            trace.push("step:start");
          },
          pipe: async () => ({ reason: "complete" as const }),
          send: async () => {},
          end: async () => {
            trace.push("step:end");
          },
        }),
        end: endRun(identity.runId),
      };
    },
  };

  return {
    delivery: {
      session: async () => session as never,
      continuityGeneration: () => continuityLosses,
      close: () => {},
    },
    trace,
    terminals,
    isSuspended: (runId = RUN_ID) => suspendedRuns.has(runId),
    cancel: () => {
      cancelled = true;
      for (const controller of controllers) {
        controller.abort();
      }
    },
    // What the library does on continuity loss: bump the generation AND abort
    // every registered run, which is exactly why the two are confusable.
    loseContinuity: () => {
      continuityLosses += 1;
      for (const controller of controllers) {
        controller.abort();
      }
    },
  };
}

/** Did `operation` settle, or is it still parked? Never resolves on its own. */
async function settledWithin<T>(
  operation: Promise<T>,
  ms: number
): Promise<{ settled: true; value: T } | { settled: false }> {
  const parked = Symbol("parked");
  const result = await Promise.race([
    operation,
    new Promise<typeof parked>((resolve) => setTimeout(() => resolve(parked), ms)),
  ]);
  return result === parked ? { settled: false } : { settled: true, value: result as T };
}

describe("Studio Agent run opening", () => {
  /**
   * THE BUG THAT MADE THE PANEL UNUSABLE, AS A TEST.
   *
   * The browser publishes `ai-input` roughly 100ms before it POSTs the
   * invocation, and the worker only attaches to the channel once Temporal has
   * scheduled the activity — so the trigger is ALWAYS in history rather than
   * live on the first turn of a thread. Without draining `run.view` first,
   * `run.start()` awaits a live fold-in that can never happen and the turn dies
   * silently four minutes later.
   */
  it("drains channel history before starting the run, so a trigger published before the worker attached still opens the turn", async () => {
    const channel = coldChannel();
    const activities = createStudioAgentActivities({
      gateway: gateway({}),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    const opening = await settledWithin(
      activityEnvironment().run(activities.openAgentRun, openRequest()),
      250
    );

    expect(opening.settled).toBe(true);
    // Order, not just presence: draining AFTER start() is the same hang.
    expect(channel.trace).toEqual(["createRun", "loadOlder", "start"]);
  });

  it("keeps paging until the whole branch is in the tree, not just one page", async () => {
    const channel = coldChannel({
      historyEventIds: ["evt-older-1", "evt-older-2", TRIGGER_EVENT_ID],
    });
    const activities = createStudioAgentActivities({
      gateway: gateway({}),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    const opening = await settledWithin(
      activityEnvironment().run(activities.openAgentRun, openRequest()),
      250
    );

    expect(opening.settled).toBe(true);
    expect(channel.trace.filter((entry) => entry === "loadOlder")).toHaveLength(3);
  });

  /**
   * A creator who presses stop while the run is still opening has not caused a
   * failure, and must not be billed for one.
   */
  it("reports a cancel that beat the open as a client cancellation, not a run failure", async () => {
    const channel = coldChannel();
    const activities = createStudioAgentActivities({
      gateway: gateway({}),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });
    channel.cancel();

    const failure = await activityEnvironment()
      .run(activities.openAgentRun, openRequest())
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      type: STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE,
      nonRetryable: true,
    });
  });
});

describe("Studio Agent run suspension", () => {
  /**
   * WHAT A SUBSCRIBER SEES WHILE A TURN WAITS ON A HUMAN.
   *
   * Before this activity existed, the run stayed OPEN on the channel for the
   * whole time the creator took to answer — measured at 90+ seconds — and
   * `RunInfo` is the panel's only source of truth for liveness, so every
   * browser watching the thread rendered a spinner for a turn that was waiting
   * on a button. `run.suspend()` is the library's own vocabulary for a pause
   * that is not a terminal.
   */
  it("adopts the open run and publishes a suspend, so the panel stops showing work in progress", async () => {
    const channel = coldChannel();
    const activities = createStudioAgentActivities({
      gateway: gateway({}),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    await activityEnvironment().run(activities.suspendAgentRun, suspendRequest());

    expect(channel.isSuspended()).toBe(true);
    // Adopt-then-suspend, never create: the run is already open, and the library
    // refuses to suspend a run this process has neither started nor loaded.
    expect(channel.trace).toEqual(["adoptRun", "load", "suspend"]);
  });

  /**
   * Temporal delivers activities at least once. A retry that finds the run
   * already suspended has nothing to do — and must not fail the turn, because a
   * creator can still rescue it by answering.
   */
  it("treats a retry against an already-suspended run as done, not as a failure", async () => {
    const channel = coldChannel();
    const activities = createStudioAgentActivities({
      gateway: gateway({}),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    await activityEnvironment().run(activities.suspendAgentRun, suspendRequest());
    await expect(
      activityEnvironment({ activityId: "2" }).run(activities.suspendAgentRun, suspendRequest())
    ).resolves.toBeUndefined();

    expect(channel.trace.filter((entry) => entry === "suspend")).toHaveLength(1);
  });

  it("publishes nothing for a delegated task, which has no channel to pause", async () => {
    const channel = coldChannel();
    const activities = createStudioAgentActivities({
      gateway: gateway({}),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    await activityEnvironment().run(activities.suspendAgentRun, suspendRequest(workflowInput()));

    expect(channel.trace).toEqual([]);
  });
});

describe("Studio Agent run terminal", () => {
  it("ends the adopted run and carries the failure detail onto the terminal", async () => {
    const channel = coldChannel();
    const activities = createStudioAgentActivities({
      gateway: gateway({}),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    await activityEnvironment().run(
      activities.closeAgentRun,
      closeRequest("the control plane refused the turn")
    );

    expect(channel.terminals).toEqual([
      {
        runId: RUN_ID,
        reason: "error",
        errorMessage: "runtime.workflow_failed: the control plane refused the turn",
      },
    ]);
  });

  /**
   * THE SILENT-FAILURE HALF OF THE OUTAGE.
   *
   * When the open failed there was no `ai-run-start` to adopt, so the terminal
   * was skipped entirely and the panel waited on a channel that would never
   * speak again. Postgres knew the run had failed; the creator never did. A run
   * that cannot be adopted must be OPENED so it can be closed.
   */
  it("opens and immediately ends a run whose ai-run-start never reached the channel", async () => {
    const channel = coldChannel({ runStartOnChannel: false });
    const activities = createStudioAgentActivities({
      gateway: gateway({}),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    const closing = await settledWithin(
      activityEnvironment().run(activities.closeAgentRun, closeRequest("ably unreachable")),
      500
    );

    expect(closing.settled).toBe(true);
    expect(channel.trace).toEqual([
      "adoptRun",
      "load",
      "createRun",
      "loadOlder",
      "start",
      "end:error",
    ]);
    expect(channel.terminals).toEqual([
      {
        runId: RUN_ID,
        reason: "error",
        errorMessage: "runtime.workflow_failed: ably unreachable",
      },
    ]);
  });
});

describe("Studio Agent creator cancel", () => {
  /**
   * `session.cancel(runId)` fires the adopted run's abort signal and nothing
   * else. Before this was wired, that abort reached only `step.pipe`, which
   * returned `cancelled`; model-runner rethrew, Temporal's own signal had never
   * fired, and the turn was recorded — and billed — as an ERROR the creator had
   * deliberately caused.
   */
  it("names a mid-stream creator cancel as a client cancellation instead of a model failure", async () => {
    const channel = coldChannel();
    const activities = createStudioAgentActivities({
      gateway: gateway({
        loadModelPlan: async () => {
          channel.cancel();
          await Promise.resolve();
          throw new Error("The model stream was cancelled.");
        },
      }),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    const failure = await activityEnvironment()
      .run(activities.runModelStep, deliveredInput())
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApplicationFailure);
    expect(failure).toMatchObject({
      type: STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE,
      nonRetryable: true,
    });
    expect(failure).not.toBeInstanceOf(CancelledFailure);
  });

  /**
   * THE IMPOSTOR.
   *
   * Channel continuity loss aborts every registered run's controller — the
   * same signal a creator's stop fires, on the same object. Calling that a
   * cancellation would tell the creator they stopped a turn that a dropped
   * websocket killed, record a `cancelled` run in Postgres, and bury the
   * transport fault that actually needs fixing.
   */
  it("does not mistake a channel continuity loss for a creator cancel", async () => {
    const channel = coldChannel();
    const activities = createStudioAgentActivities({
      gateway: gateway({
        loadModelPlan: async () => {
          channel.loseContinuity();
          await Promise.resolve();
          throw new Error("unable to continue; channel continuity lost (attached, resumed: false)");
        },
      }),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    const failure = await activityEnvironment()
      .run(activities.runModelStep, deliveredInput())
      .catch((error: unknown) => error);

    expect(failure).not.toBeInstanceOf(ApplicationFailure);
    expect((failure as Error).message).toContain("channel continuity lost");
  });

  /**
   * A steer cancels the Temporal activity AND the run's own signal. It is a
   * continuation, not a stop, so it must stay a Temporal cancellation.
   */
  it("keeps a Temporal steer a Temporal cancellation even though both signals fire", async () => {
    const channel = coldChannel();
    const environment = activityEnvironment();
    const activities = createStudioAgentActivities({
      gateway: gateway({
        loadModelPlan: async () => {
          environment.cancel();
          channel.cancel();
          await Promise.resolve();
          throw new Error("The model stream was aborted.");
        },
      }),
      modelConfig: modelConfig(),
      delivery: channel.delivery,
    });

    const failure = await environment
      .run(activities.runModelStep, deliveredInput())
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CancelledFailure);
  });
});

function gateway(overrides: Partial<StudioAgentRuntimeGateway>): StudioAgentRuntimeGateway {
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected gateway call.");
  };
  return {
    appendEvent: unused,
    loadModelPlan: unused,
    completeContextCompaction: unused,
    failContextCompaction: unused,
    prepareAction: unused,
    prepareChildRun: unused,
    executeAction: unused,
    denyAction: unused,
    resolveApproval: unused,
    consumeInput: unused,
    transitionRun: unused,
    ...overrides,
  };
}

function modelConfig() {
  return {
    apiKey: "test",
    baseUrl: undefined,
    textModelId: "qwen3-max",
    visionModelId: "qwen3-vl-plus",
    timeoutMs: 120_000,
    maxOutputTokens: 8_192,
  };
}

/**
 * A delivery client that would fail loudly if anything reached for a channel.
 *
 * These activities all run on task-shaped workflow inputs (`delivery: null`),
 * so the transport must never be touched; a stub that threw only on use is how
 * that stays true when the tests change.
 */
function deliveryClient(): StudioAgentDeliveryClient {
  return {
    session: () => {
      throw new Error("A task run must not open a delivery session.");
    },
    continuityGeneration: () => 0,
    close: () => {},
  };
}

function workflowInput(): StudioAgentWorkflowInput {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: THREAD_ID,
    runId: RUN_ID,
    rootRunId: RUN_ID,
    parentRunId: null,
    kind: "turn",
    scenario: { id: "story.studio.assistant", version: "1.0.0" },
    permissionPolicy: { policyId: POLICY_ID, revision: 1 },
    delivery: null,
  };
}

function executeRequest(): StudioAgentExecuteActionRequest {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    actionId: ACTION_ID,
    runId: RUN_ID,
    inputHash: HASH,
  };
}

function denyRequest(): StudioAgentDenyActionRequest {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    actionId: ACTION_ID,
    runId: RUN_ID,
    approvalId: "33333333-3333-4333-8333-333333333333",
    actionInputHash: HASH,
    disposition: "expired",
    reason: "Approval expired.",
    decidedAt: "2026-07-24T01:00:00.000Z",
  };
}

function actionExecution(): StudioAgentActionExecution {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    executionId: "44444444-4444-4444-8444-444444444444",
    actionId: ACTION_ID,
    status: "succeeded",
    output: { applied: true },
    error: null,
    changeSet: null,
    startedAt: "2026-07-24T01:00:00.000Z",
    completedAt: "2026-07-24T01:00:01.000Z",
  };
}
