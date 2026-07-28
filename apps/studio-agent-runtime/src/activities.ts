import { ErrorCode, errorInfoIs, type RunEndParams, type StreamResult } from "@ably/ai-transport";
import { stepIdFor } from "@ably/ai-transport/temporal";
import { ApplicationFailure, CancelledFailure, Context } from "@temporalio/activity";
import * as Ably from "ably";
import {
  STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE,
  type StudioAgentAction,
  type StudioAgentActionExecution,
  type StudioAgentApproval,
  type StudioAgentApprovalSignal,
  type StudioAgentInput,
  type StudioAgentInputSignal,
  type StudioAgentModelStepOutcome,
  type StudioAgentRun,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";
import type {
  StudioAgentCloseRunRequest,
  StudioAgentDenyActionRequest,
  StudioAgentExecuteActionRequest,
  StudioAgentOpenRunRequest,
  StudioAgentRunTransitionRequest,
  StudioAgentSuspendRunRequest,
} from "@repo/shared/studio-agent-api";
import {
  studioAgentInvocation,
  type StudioAgentDeliveryClient,
  type StudioAgentUIChunk,
} from "./agent-session.js";
import { createAppendCeilingSplitter, enforceDiscreteAppendCeiling } from "./append-ceiling.js";
import type { RuntimeModelConfig } from "./config.js";
import {
  RuntimeGatewayHttpError,
  RuntimeGatewayProtocolError,
  type StudioAgentRuntimeGateway,
} from "./gateway-client.js";
import { runQwenModelStep, type ModelStepDelivery } from "./model-runner.js";

// Temporal fails the model activity if no heartbeat arrives within
// workflows.ts' heartbeatTimeout. During generation the only heartbeats come
// from stream parts, so a long time-to-first-token (common for a large
// storyboard context, and for the non-streaming compaction generateText call)
// looks like a hang and fails the run with no retry. An independent timer
// keeps the activity alive across TTFT and inter-token gaps regardless of
// provider latency. Kept well under heartbeatTimeout.
const MODEL_STEP_HEARTBEAT_INTERVAL_MS = 5_000;

export interface StudioAgentActivities {
  openAgentRun(request: StudioAgentOpenRunRequest): Promise<void>;
  suspendAgentRun(request: StudioAgentSuspendRunRequest): Promise<void>;
  closeAgentRun(request: StudioAgentCloseRunRequest): Promise<void>;
  runModelStep(workflow: StudioAgentWorkflowInput): Promise<StudioAgentModelStepOutcome>;
  transitionRun(request: StudioAgentRunTransitionRequest): Promise<StudioAgentRun>;
  executeAction(request: StudioAgentExecuteActionRequest): Promise<StudioAgentActionExecution>;
  denyAction(request: StudioAgentDenyActionRequest): Promise<StudioAgentAction>;
  resolveApproval(signalValue: StudioAgentApprovalSignal): Promise<StudioAgentApproval[]>;
  consumeInput(signalValue: StudioAgentInputSignal): Promise<StudioAgentInput>;
}

export function createStudioAgentActivities(dependencies: {
  gateway: StudioAgentRuntimeGateway;
  modelConfig: RuntimeModelConfig;
  delivery: StudioAgentDeliveryClient;
}): StudioAgentActivities {
  const { gateway, modelConfig, delivery } = dependencies;
  return {
    /**
     * Put the run on the channel — as a start, or as a RESUME.
     *
     * `RunRuntime.runId` is our own run id, so a fresh-process retry of this
     * activity re-enters the SAME run instead of minting a parallel one — the
     * durable-execution contract the SDK documents.
     *
     * THE LIBRARY, NOT THIS FUNCTION, DECIDES WHICH LIFECYCLE EVENT GOES OUT.
     * `resolveTriggerMetadata` reads the trigger event's `run-id` header and
     * sets `resolvedContinuation = wireRunId !== undefined`; `startRun` then
     * publishes `ai-run-resume` instead of `ai-run-start` and skips the
     * optimistic run-node insert. A fresh prompt carries no run-id header and a
     * continuation (the browser's `tool-approval-response`) always does, because
     * the client transport stamps `sendOpts.runId` on it. So the caller supplies
     * the TRIGGER and nothing else — which is exactly why the trigger is a
     * parameter here rather than being read off `workflow.delivery`: a resume's
     * trigger is a different event, minted when the creator answered.
     *
     * A resume is also the ONLY way back from a suspend: `adoptRun().load()`
     * refuses a suspended run outright ("resume via createRun().start()").
     *
     * THE DRAIN IS LOAD-BEARING. `start()` awaits `located` — the triggering
     * `ai-input` folding into the Tree — and the library's input-event watcher
     * is passive: `input-event-locator.ts` says in as many words "This is a
     * passive watcher — it never pages history itself". Our worker attaches to
     * the channel only after Temporal schedules this activity, which is always
     * AFTER the browser published its input, so on a cold channel the trigger
     * is in HISTORY and no live arrival will ever fold it in. `located` has no
     * deadline, so without the drain below `start()` simply never returns: the
     * activity burns its start-to-close, retries, and the turn dies at the
     * schedule-to-close with nothing on the creator's screen. Draining
     * `run.view` is the documented cold-start path — it is what pages history
     * into the Tree — and it must run BEFORE `start()`, not after.
     */
    async openAgentRun(request) {
      const { workflow, trigger } = request;
      const context = Context.current();
      return withGatewayHeartbeat(
        context,
        { runId: workflow.runId, phase: "opening" },
        async () => {
          const session = await delivery.session(trigger.channelName);
          const run = session.createRun(
            studioAgentInvocation(trigger.inputEventId, trigger.channelName),
            {
              runId: workflow.runId,
              invocationId: `${workflow.runId}:open:${trigger.inputEventId}`,
              signal: context.cancellationSignal,
            }
          );
          const continuity = delivery.continuityGeneration(trigger.channelName);
          await drainRunHistory(run, () => context.heartbeat({ phase: "draining" }));
          try {
            await run.start();
          } catch (error) {
            throw (
              asClientCancellation(error, {
                abortSignal: run.abortSignal,
                continuityLost: delivery.continuityGeneration(trigger.channelName) !== continuity,
              }) ?? error
            );
          }
        }
      );
    },

    /**
     * Publish `ai-run-suspend`, so a turn parked on an approval stops claiming
     * to be working.
     *
     * THE GAP THIS CLOSES WAS MEASURED. A run waiting on a human decision left
     * the Run OPEN on the channel for as long as the creator took to answer —
     * 90+ seconds in the observed case — and `RunInfo` is the panel's only
     * source of truth for "is this turn live", so every subscriber rendered a
     * spinner for a turn that was waiting on a button. `run.suspend()` is the
     * library's own vocabulary for exactly this: not a terminal (the run stays
     * live and resumable under the same id) but a visible pause.
     *
     * ADOPT, DON'T CREATE. The run is already open, and the library forbids
     * suspending a run this process has neither started nor loaded. It also
     * forbids suspending with a step still open — `runModelStep` ends its step
     * in its own `finally`, before this ever runs.
     *
     * Idempotent under Temporal's at-least-once retry: `suspend()` on a run
     * already suspended in THIS process is a documented no-op, and a retry in a
     * fresh process re-adopts and re-publishes, which the Tree collapses (a
     * suspend records `endSerial` and the status is already `suspended`).
     */
    async suspendAgentRun(request) {
      const trigger = request.workflow.delivery;
      if (!trigger) return;
      const context = Context.current();
      const runId = request.workflow.runId;
      return withGatewayHeartbeat(context, { runId, phase: "suspending" }, async () => {
        const session = await delivery.session(trigger.channelName);
        const run = session.adoptRun({
          runId,
          invocationId: `${runId}:suspend:${context.info.activityId}`,
          triggerEventId: trigger.inputEventId,
        });
        try {
          await run.load({ timeoutMs: ADOPT_RUN_START_TIMEOUT_MS });
        } catch (error) {
          // A run this process already suspended, or a retry that lost the
          // race to a sibling attempt, reports `InvalidArgument` ("suspended,
          // resume via createRun().start()"). That is proof the suspend landed,
          // not a failure — and failing here would fail a turn the creator can
          // still rescue by answering.
          if (error instanceof Ably.ErrorInfo && errorInfoIs(error, ErrorCode.InvalidArgument)) {
            return;
          }
          throw error;
        }
        await run.suspend();
      });
    },

    /**
     * Publish the run's terminal. NOT optional and NOT best-effort.
     *
     * Ably's production guidance is explicit: a turn that exhausts its retries
     * without `run.end` leaves the Run open, so every subscriber's UI stays on
     * `streaming` forever. The workflow calls this non-cancellably on EVERY exit
     * path — including the one where `openAgentRun` itself failed.
     *
     * WHICH IS WHY THIS HAS TWO PATHS, NOT ONE. The happy path adopts the open
     * run and ends it. But a turn can die before `ai-run-start` was ever
     * published (the open failed, or the control plane refused the turn), and
     * then there is nothing to adopt: `load()` reports `InputEventNotFound`.
     * The creator is still owed an answer, and the only place they are looking
     * is the channel — so this opens the run and immediately ends it, which
     * renders as a turn that started and failed rather than as a panel that
     * waits forever. Gating the terminal on "the open succeeded" is exactly how
     * a failed run became silence.
     *
     * Idempotent against an at-least-once retry: adopting a run the previous
     * attempt already ended is refused with `InvalidArgument` ("terminal,
     * read-only"), which is proof the terminal landed, not a failure.
     */
    async closeAgentRun(request) {
      const trigger = request.workflow.delivery;
      if (!trigger) return;
      const context = Context.current();
      const runId = request.workflow.runId;
      const terminal: RunEndParams =
        request.reason === "error"
          ? {
              reason: "error",
              ...(request.error ? { error: terminalErrorInfo(request.error) } : {}),
            }
          : { reason: request.reason };
      return withGatewayHeartbeat(context, { runId, phase: "closing" }, async () => {
        const session = await delivery.session(trigger.channelName);
        const run = session.adoptRun({
          runId,
          invocationId: `${runId}:close:${context.info.activityId}`,
          triggerEventId: trigger.inputEventId,
        });
        try {
          // Bounded well under this activity's start-to-close. The default is
          // 30s, which on the never-opened path is 30s of waiting for a
          // run-start that cannot exist before the fallback can even begin.
          await run.load({ timeoutMs: ADOPT_RUN_START_TIMEOUT_MS });
        } catch (error) {
          if (error instanceof Ably.ErrorInfo && errorInfoIs(error, ErrorCode.InvalidArgument)) {
            return;
          }
          if (
            !(error instanceof Ably.ErrorInfo) ||
            !errorInfoIs(error, ErrorCode.InputEventNotFound)
          ) {
            // `OperationCancelled` lands here on purpose: a cancel that arrived
            // between `adoptRun` and `load` aborted THIS run object's signal.
            // A Temporal retry builds a fresh registration whose signal is
            // clean, so the retry is the fix and swallowing it would be the bug.
            throw error;
          }
          await openThenEndRun({
            session,
            trigger,
            runId,
            invocationId: `${runId}:close-open:${context.info.activityId}`,
            terminal,
            heartbeat: () => context.heartbeat({ runId, phase: "closing_unopened" }),
          });
          return;
        }
        await run.end(terminal);
      });
    },

    async runModelStep(workflow) {
      const context = Context.current();
      const heartbeat = setInterval(() => {
        try {
          context.heartbeat({ phase: "model_step_alive" });
        } catch {
          // The activity finished between the timer firing and clearInterval;
          // a heartbeat after completion is meaningless, not an error.
        }
      }, MODEL_STEP_HEARTBEAT_INTERVAL_MS);
      const step = await openTransportStep(delivery, workflow, context);
      // TWO THINGS CAN STOP THIS TURN, AND THEY MEAN DIFFERENT THINGS.
      //
      // Temporal's `cancellationSignal` is the workflow steering or stopping
      // the step. The adopted run's `abortSignal` is the CREATOR pressing stop
      // in the browser: `session.cancel(runId)` publishes `ai-cancel` and the
      // transport routes it to the run that this activity holds. Before this
      // was wired, the creator's cancel reached only `step.pipe`, which lost
      // its race and returned `cancelled`; model-runner turned that into a
      // throw, and — because Temporal's own signal had not fired — the run was
      // recorded as an ERROR the creator was then shown and billed for.
      // Composing both into the signal the model sees makes the abort prompt
      // and makes `cancelled` the disposition everywhere downstream.
      const cancellation = step
        ? AbortSignal.any([context.cancellationSignal, step.abortSignal])
        : context.cancellationSignal;
      const channelName = workflow.delivery?.channelName;
      const continuity = channelName ? delivery.continuityGeneration(channelName) : 0;
      try {
        return await runQwenModelStep(workflow, {
          gateway,
          config: modelConfig,
          delivery: step,
          observer: {
            signal: cancellation,
            heartbeat(details) {
              context.heartbeat(details);
            },
            now: () => new Date(),
          },
        });
      } catch (error) {
        // A steer / stop_and_send cancels the activity's cancellationSignal.
        // Temporal records the activity as *cancelled* (letting the workflow
        // resume or supersede) only when the thrown error is a CancelledFailure
        // (or a DOMException named AbortError). The AI SDK surfaces a mid-stream
        // abort as an `abort` stream part that model-runner rethrows as a plain
        // Error, and in-flight gateway calls reject on the aborted signal too —
        // both would otherwise be recorded as a genuine failure and fail the
        // whole run, dropping the user's steering input. Coerce anything seen
        // while cancelled into a CancelledFailure.
        if (context.cancellationSignal.aborted) {
          throw new CancelledFailure(
            error instanceof Error ? error.message : "The model step was cancelled."
          );
        }
        // Ordered after the Temporal check on purpose: a steer cancels both
        // signals, and a steer is a continuation, not a stop.
        throw (
          asClientCancellation(error, {
            abortSignal: step?.abortSignal,
            continuityLost: channelName
              ? delivery.continuityGeneration(channelName) !== continuity
              : false,
          }) ?? error
        );
      } finally {
        clearInterval(heartbeat);
        // `RunStep.end` with no reason derives `failed` when a pipe errored and
        // `complete` otherwise, so the step's disposition follows the stream
        // without this having to interpret the throw. Publishing the step
        // terminal must not turn a model failure into a different failure, so a
        // close that fails is reported and swallowed — the RUN terminal, which
        // is what actually unsticks a subscriber, is the workflow's own
        // non-cancellable `closeAgentRun`.
        await step?.close();
      }
    },
    async transitionRun(request) {
      const context = Context.current();
      return withGatewayHeartbeat(
        context,
        { transition: request.transition, phase: "requesting" },
        () => invokeGateway(() => gateway.transitionRun(request, context.cancellationSignal))
      );
    },
    async executeAction(request) {
      const context = Context.current();
      // Cancelling the HTTP wait does not roll back a control-plane transaction
      // that has already begun. The action id is the canonical idempotency
      // fence, so a retry or reconnect observes the committed terminal result
      // while steer/stop does not wait on an unreachable gateway for minutes.
      return withGatewayHeartbeat(context, { actionId: request.actionId, phase: "executing" }, () =>
        invokeGateway(() => gateway.executeAction(request, context.cancellationSignal))
      );
    },
    async denyAction(request) {
      const context = Context.current();
      return withGatewayHeartbeat(context, { actionId: request.actionId, phase: "denying" }, () =>
        invokeGateway(() => gateway.denyAction(request, context.cancellationSignal))
      );
    },
    async resolveApproval(signalValue) {
      const context = Context.current();
      return withGatewayHeartbeat(
        context,
        {
          approvalIds: signalValue.decisions.map((decision) => decision.approvalId),
          phase: "resolving",
        },
        () => invokeGateway(() => gateway.resolveApproval(signalValue, context.cancellationSignal))
      );
    },
    async consumeInput(signalValue) {
      const context = Context.current();
      return withGatewayHeartbeat(
        context,
        { inputId: signalValue.inputId, phase: "consuming" },
        () => invokeGateway(() => gateway.consumeInput(signalValue, context.cancellationSignal))
      );
    },
  };
}

/**
 * Adopt the open run and start this activity's transport step.
 *
 * THE SUPERSEDE CONTRACT, WHICH IS THE ENTIRE REASON TEMPORAL AND THIS LIBRARY
 * COMPOSE. `stepIdFor` reads `Context.current().info.activityId`, which Temporal
 * holds STABLE across every attempt of one activity, so a retry in a fresh
 * process re-emits `ai-step-start` under the SAME step id and the channel
 * SUPERSEDES the dead attempt's output. Omit the id and the SDK mints a fresh
 * one, and the retry's answer is appended BESIDE the failed attempt's — a
 * silent double-answer in the user's face. Never hand-build dedupe here.
 *
 * DELIBERATE DIVERGENCE FROM THE LIBRARY'S CONVENTION. `stepIdFor` is documented
 * to take the run's invocation id, "which is also used as the Temporal
 * workflowId". Ours is not: our workflowId is the RUN id (`client.start(...,
 * { workflowId: runId })`, `startChild(..., { workflowId: descriptor.runId })`).
 * The helper only needs a per-workflow-unique stable prefix, so the run id is
 * correct and collision-free — but it is a divergence, and it is written down
 * here rather than left to be discovered.
 */
async function openTransportStep(
  delivery: StudioAgentDeliveryClient,
  workflow: StudioAgentWorkflowInput,
  context: Context
): Promise<(ModelStepDelivery & { abortSignal: AbortSignal; close(): Promise<void> }) | null> {
  const trigger = workflow.delivery;
  if (!trigger) return null;
  const session = await delivery.session(trigger.channelName);
  const run = session.adoptRun({
    runId: workflow.runId,
    invocationId: `${workflow.runId}:step:${context.info.activityId}`,
    triggerEventId: trigger.inputEventId,
  });
  await run.load({ timeoutMs: ADOPT_RUN_START_TIMEOUT_MS });
  const stepId = stepIdFor(workflow.runId);
  const step = run.createStep({ stepId });
  await step.start();
  /**
   * ONE assistant message per step, and everything the step says goes into it.
   *
   * `RunStep.send()` is documented as publishing "a single discrete output as
   * ONE assistant message". So a step that streamed a reply and then reported
   * its terminal activity produced TWO messages: the reply, and a message whose
   * only content was a `data-studio-agent-activity` part. That is wrong twice
   * over.
   *
   * It breaks the panel's shape: work steps are meant to fold INTO the reply
   * that produced them, not sit beside it as their own turn.
   *
   * And it silently broke tool approval, which is how it was found. The AI SDK's
   * `addToolApprovalResponse` rewrites `messages[messages.length - 1]` and ONLY
   * that message; a trailing activity-only message therefore displaced the
   * message carrying the approval, and every Approve click became a no-op with
   * no error — verified in the browser: 52 messages, approval on index 50, last
   * message an activity-only assistant.
   *
   * So the step opens exactly one outbound stream and keeps it open for its whole
   * life. `pipe` pumps the model's chunks into it and resolves when the MODEL is
   * done — not when the message is done — so a terminal activity published after
   * the stream still lands on the same message. `close()` is what ends it.
   */
  const outbound = new TransformStream<StudioAgentUIChunk, StudioAgentUIChunk>();
  const writer = outbound.writable.getWriter();
  let outboundClosed = false;

  const piping = step
    .pipe(
      outbound.readable.pipeThrough(
        createAppendCeilingSplitter({
          report: (entry) => {
            context.log.info(entry.message, {
              runId: workflow.runId,
              stepId,
              appendCeiling: entry.kind,
              streamId: entry.streamId,
              segment: entry.segment,
              bytes: entry.bytes,
            });
          },
        })
      ) as ReadableStream<StudioAgentUIChunk>
    )
    .catch(
      (error: unknown): StreamResult => ({
        reason: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      })
    );

  const write = async (chunk: StudioAgentUIChunk): Promise<void> => {
    if (outboundClosed) return;
    // The splitter downstream rolls a long TEXT part onto a continuation, but a
    // data part cannot be rolled — it either fits or the encoder refuses it and
    // the nack fails the step. Only `error.details` is unbounded, so this is
    // where that gets shed; see append-ceiling.ts.
    await writer.write(
      enforceDiscreteAppendCeiling(chunk, {
        report: (entry) => {
          context.log.warn(entry.message, {
            runId: workflow.runId,
            stepId,
            appendCeiling: entry.kind,
            bytes: entry.bytes,
          });
        },
      })
    );
  };

  return {
    stepId,
    abortSignal: run.abortSignal,
    /**
     * Drive the model's chunks into the step's one message.
     *
     * Resolves when the MODEL stream ends so the caller can read its outcome and
     * publish the terminal activity — which then still reaches the same message,
     * because the outbound stream is not closed here. A transport failure that
     * happens while the model is still producing is raced in, so the caller
     * learns about it at the same point it used to.
     */
    pipe: async (stream) => {
      const pumped = (async (): Promise<StreamResult> => {
        const reader = stream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return { reason: "complete" };
            await write(value);
          }
        } catch (error) {
          return {
            reason: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          };
        } finally {
          reader.releaseLock();
        }
      })();
      return Promise.race([
        pumped,
        piping.then((result): StreamResult | Promise<StreamResult> =>
          // A clean transport finish before the model is done cannot happen while
          // we hold the writer open, so only an error is a real race winner.
          result.reason === "error" ? result : pumped
        ),
      ]);
    },
    send: write,
    close: async () => {
      outboundClosed = true;
      try {
        await writer.close();
      } catch {
        // Already errored or closed; `piping` carries the reason.
      }
      await piping;
      try {
        await step.end();
      } catch {
        // Reported through the run terminal instead; see the call site.
      }
    },
  };
}

/**
 * How long to wait for a run's `ai-run-start` to be observed on the channel.
 *
 * The library's default is 30s. Both call sites live inside activities bounded
 * by a 60s start-to-close, and one of them (`closeAgentRun`) has real work to
 * do AFTER the wait fails — so the wait has to leave room for it.
 */
const ADOPT_RUN_START_TIMEOUT_MS = 10_000;

/**
 * Page the whole reachable branch into the Tree.
 *
 * `loadOlder()` is the ONLY thing that drives the session's history hydrator;
 * the run's input-event watcher never pages on its own. Everything the run
 * needs from before it existed — above all its own triggering `ai-input` —
 * becomes visible here or not at all.
 */
async function drainRunHistory(
  run: { view: { hasOlder(): boolean; loadOlder(): Promise<unknown> } },
  heartbeat: () => void
): Promise<void> {
  while (run.view.hasOlder()) {
    heartbeat();
    await run.view.loadOlder();
  }
}

/**
 * Open a run that was never opened, purely so it can be closed.
 *
 * The only caller is the terminal path for a turn that died before
 * `ai-run-start`. Draining first for the same reason `openAgentRun` does: the
 * trigger is in history, and `start()` waits on it forever otherwise.
 */
async function openThenEndRun(input: {
  session: Awaited<ReturnType<StudioAgentDeliveryClient["session"]>>;
  trigger: NonNullable<StudioAgentWorkflowInput["delivery"]>;
  runId: string;
  invocationId: string;
  terminal: RunEndParams;
  heartbeat: () => void;
}): Promise<void> {
  const run = input.session.createRun(
    studioAgentInvocation(input.trigger.inputEventId, input.trigger.channelName),
    { runId: input.runId, invocationId: input.invocationId }
  );
  await drainRunHistory(run, input.heartbeat);
  await run.start();
  await run.end(input.terminal);
}

/**
 * Recognise "the creator stopped this turn" and name it for the workflow.
 *
 * Two shapes reach here. The transport raises `OperationCancelled` when the
 * cancel beat `start()` / `load()`; a mid-stream cancel instead surfaces as
 * whatever the model layer threw while the run's signal was already aborted.
 * Both are the same event and both must land on the workflow's cancel path
 * rather than its failure path.
 *
 * AND ONE IMPOSTOR, WHICH IS WHY `continuityLost` EXISTS. A channel that loses
 * message continuity makes the library abort every registered run on it
 * (`agent-session.ts`: "Abort every active run's controller FIRST") and swap
 * the Tree. The abort is indistinguishable from a cancel at the signal, so
 * without this the worker would tell a creator they had stopped a turn that
 * a dropped websocket actually killed — and would swallow the transport fault
 * that needs fixing. A continuity loss stays an error.
 */
function asClientCancellation(
  error: unknown,
  run: { abortSignal: AbortSignal | undefined; continuityLost: boolean }
): ApplicationFailure | null {
  if (run.continuityLost) {
    return null;
  }
  const cancelledByTransport =
    error instanceof Ably.ErrorInfo && errorInfoIs(error, ErrorCode.OperationCancelled);
  if (!cancelledByTransport && !run.abortSignal?.aborted) {
    return null;
  }
  return ApplicationFailure.nonRetryable(
    error instanceof Error && error.message
      ? error.message
      : "The creator cancelled the run on the conversation channel.",
    STUDIO_AGENT_CLIENT_CANCELLED_FAILURE_TYPE
  );
}

/**
 * Our string-coded error, as the numeric-coded one `ai-run-end` can carry.
 *
 * `Ably.ErrorInfo.code` is a number in Ably's own registry, so our
 * `runtime.workflow_failed` cannot travel in it. It goes into the message,
 * which is the field a human reads, and the numeric code stays the generic
 * server-error class rather than pretending to be an Ably condition.
 */
function terminalErrorInfo(error: { code: string; message: string }): Ably.ErrorInfo {
  return new Ably.ErrorInfo(`${error.code}: ${error.message}`.slice(0, 2_000), 50_000, 500);
}

// The gateway proxy activities carry a 10s heartbeatTimeout but the control
// plane's HTTP call can legitimately take up to the gateway's own timeout
// (~30s, e.g. under a lock or a slow DB). Heartbeating only before the call
// then meant any response slower than 10s tripped a spurious heartbeat timeout
// — burning retries and eventually failing the run. An independent timer keeps
// the activity alive while the single in-flight call runs; it never masks a
// dead worker because the startToClose timeout still bounds the whole activity.
const GATEWAY_HEARTBEAT_INTERVAL_MS = 3_000;

async function withGatewayHeartbeat<T>(
  context: Context,
  details: Record<string, unknown>,
  operation: () => Promise<T>
): Promise<T> {
  context.heartbeat(details);
  const timer = setInterval(() => {
    try {
      context.heartbeat(details);
    } catch {
      // The activity settled between the timer firing and clearInterval.
    }
  }, GATEWAY_HEARTBEAT_INTERVAL_MS);
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}

async function invokeGateway<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RuntimeGatewayProtocolError) {
      throw ApplicationFailure.nonRetryable(error.message, "studio_agent_gateway_protocol_error");
    }
    if (error instanceof RuntimeGatewayHttpError && isNonRetryableHttpStatus(error.status)) {
      throw ApplicationFailure.nonRetryable(
        error.message,
        "studio_agent_gateway_command_rejected",
        { status: error.status }
      );
    }
    throw error;
  }
}

function isNonRetryableHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && ![408, 425, 429].includes(status);
}
