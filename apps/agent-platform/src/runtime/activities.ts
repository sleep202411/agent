import { randomUUID } from "node:crypto";
import { TransformStream } from "node:stream/web";

import { Context, ApplicationFailure } from "@temporalio/activity";
import { stepIdFor } from "@ably/ai-transport/temporal";
import {
  approvedPendingToolCalls,
  createAgentSession,
  pendingToolCalls,
  vercelRunOutcome,
} from "@ably/ai-transport/vercel";
import { ErrorCode, Invocation, errorInfoIs, type InvocationData } from "@ably/ai-transport";
import { toAISdkStream } from "@mastra/ai-sdk";
import type { MastraStreamTransform } from "@mastra/core/stream";
import Ably from "ably";
import { isToolUIPart, type FinishReason, type UIMessage } from "ai";
import { ZodError } from "zod";

import { AgentAttachmentInputError } from "../attachments/model-attachment-processor.js";
import { CapabilityDeniedError, getAuthorizedToolDefinition } from "../capabilities/registry.js";
import {
  agentMemoryScope,
  createAgentRequestContext,
  writeAgentCausalContext,
  type AgentSessionContext,
} from "../context/agent-context.js";
import {
  DomainAttachmentResolutionError,
  DomainGatewayUnavailableError,
  type DomainToolResult,
} from "../domain/domain-gateway.js";
import {
  classifyInferenceTier,
  inferenceThinkingProviderOptions,
  writeInferenceTier,
} from "../models/inference-policy.js";
import { classifyCanonicalRun, hasAssistantOutput } from "./conversation.js";
import { getRuntimeDependencies } from "./dependencies.js";
import { projectProductUiMessages, stripMastraInternalUiEvents } from "./product-ui-message.js";
import {
  OPEN_RUN_MAX_ATTEMPTS,
  type AgentInvocationLifecycleProjection,
  type AgentPublicError,
  type DurableRunIds,
  type InferenceActivityResult,
  type OpenRunResult,
} from "./contracts.js";
import {
  AGENT_HISTORY_PAGE_SIZE,
  acquireAgentAblyClient,
  connectAgentSession,
  releaseAgentSession,
} from "./ably-session.js";
import { classifyAgentTransportFailure } from "./ably-runtime-error.js";
import { withCanvasPreview } from "./canvas-preview.js";
import { applicationFailureDetailsFor, createAgentPublicError } from "./public-error.js";

type OpenRunInput = Readonly<{
  invocation: InvocationData;
  invocationId: string;
  provisionalRunId: string;
}>;

type RunActivityInput = Readonly<{
  ids: DurableRunIds;
  sessionName: string;
  context: AgentSessionContext;
}>;

type ToolActivityInput = RunActivityInput &
  Readonly<{
    toolCallId: string;
    toolName: string;
    arguments: unknown;
  }>;

type EndRunInput = Readonly<{
  ids: DurableRunIds;
  sessionName: string;
  reason: "error" | "cancelled";
  error?: AgentPublicError;
}>;

type InferenceControlState = {
  approvalToolCallIds: Set<string>;
  runtimeSuspensionToolCallIds: Set<string>;
};

export type SuspendedInferenceClassification =
  | Readonly<{ kind: "tool-calls"; toolCalls: ReturnType<typeof pendingToolCalls> }>
  | Readonly<{ kind: "awaiting-approval"; toolCallIds: ReadonlyArray<string> }>
  | Readonly<{ kind: "runtime-suspension"; toolCallIds: ReadonlyArray<string> }>
  | Readonly<{ kind: "inconsistent" }>;

export async function openRunActivity(input: OpenRunInput): Promise<OpenRunResult> {
  const stopHeartbeat = beginActivityHeartbeat("open-run");
  const { config } = getRuntimeDependencies();
  const client = acquireAgentAblyClient(config.ablyApiKey);
  const session = createAgentSession({
    client,
    channelName: input.invocation.sessionName,
    historyPageSize: AGENT_HISTORY_PAGE_SIZE,
  });
  const run = session.createRun(Invocation.fromJSON(input.invocation), {
    invocationId: input.invocationId,
    runId: input.provisionalRunId,
    signal: Context.current().cancellationSignal,
  });
  let mayHaveStarted = false;

  try {
    await measureActivityStage("ably.session.connect", () => connectAgentSession(client, session));
    await measureActivityStage("ably.run.locate", () => locateCreatedRun(run));
    if (run.runId !== input.provisionalRunId) {
      // The trigger named an existing Run (approval continuation): the
      // transport rebound this handle to the suspended Run during location.
      // Its pending/approved tool-call parts and terminal status live on wires
      // that can sit arbitrarily far below the trigger, so fold to the Run's
      // own boundary before reading either.
      await measureActivityStage("ably.run.hydrate-boundary", () =>
        hydrateAdoptedRunBoundary(run, session.tree)
      );
    }
    if (run.status === "complete" || run.status === "cancelled" || run.status === "error") {
      return {
        kind: "already-terminal",
        runId: run.runId,
        status: run.status,
      };
    }
    mayHaveStarted = true;
    await measureActivityStage("ably.run.start", () => run.start());
    return {
      kind: "opened",
      ids: {
        runId: run.runId,
        invocationId: run.invocationId,
        triggerEventId: input.invocation.inputEventId,
      },
      approvedToolCalls: approvedPendingToolCalls(run.messages),
    };
  } catch (error) {
    if (mayHaveStarted && Context.current().info.attempt >= OPEN_RUN_MAX_ATTEMPTS) {
      const publicError = publicActivityError(
        error,
        "AGENT_RUN_OPEN_FAILED",
        input.invocation.sessionName
      );
      await bestEffortEndRun(run, {
        reason: "error",
        error: toAblyError(publicError.code, publicError.message),
      });
    }
    if (Context.current().cancellationSignal.aborted) throw error;
    throw activityFailure(error, "AGENT_RUN_OPEN_FAILED", input.invocation.sessionName);
  } finally {
    await bestEffortReleaseSession(session);
    stopHeartbeat();
  }
}

export async function runInferenceActivity(
  input: RunActivityInput
): Promise<InferenceActivityResult> {
  const stopHeartbeat = beginActivityHeartbeat("model-inference");
  const { config, agent, agentMemory } = getRuntimeDependencies();
  const client = acquireAgentAblyClient(config.ablyApiKey);
  const session = createAgentSession({
    client,
    channelName: input.sessionName,
    historyPageSize: AGENT_HISTORY_PAGE_SIZE,
  });
  let modelStepAbort: AbortController | null = null;
  const run = session.adoptRun(input.ids, {
    signal: Context.current().cancellationSignal,
    // Steering interrupts only the current provider call. The Ably Run stays
    // active so the next durable Activity can infer again with the steering
    // message folded into canonical context.
    onSteer: () => modelStepAbort?.abort(),
  });

  try {
    await measureActivityStage("ably.session.connect", () => connectAgentSession(client, session));
    try {
      await measureActivityStage("ably.run.load", async () => {
        await primeAdoptedRunFold(run, session.tree);
        await run.load();
      });
    } catch (error) {
      const terminal = recoverTerminalInferenceResult(error, run.status);
      if (terminal) return terminal;
      throw error;
    }
    // load() only proves the run-start and trigger folds; the adopted Run's
    // full extent — a continuation's suspended turn above all — needs the fold
    // driven to the Run's parent input node before `run.messages` is a
    // trustworthy canonical source. Free (no fetch) for a fresh run, whose
    // parent is the already-located trigger.
    await measureActivityStage("ably.run.hydrate-boundary", () =>
      hydrateAdoptedRunBoundary(run, session.tree)
    );

    const requestContext = createAgentRequestContext(input.context);
    const memoryScope = agentMemoryScope(input.context);
    // This drains any pending steer into the output attribution for the next
    // step. Snapshot synchronously afterwards so exactly that input set is
    // reconciled against durable memory.
    run.hasInput();
    const canonicalState = await measureActivityStage("memory.reconcile-input", () =>
      collectCanonicalMessagesForRun([...run.messages], input, (messages) =>
        agentMemory.reconcileRunMessages(messages, memoryScope)
      )
    );
    const canonicalMessages = canonicalState.messages;
    if (canonicalMessages.length === 0) {
      throw ApplicationFailure.nonRetryable(
        "The active Ably run contains no messages.",
        "AGENT_CONVERSATION_EMPTY"
      );
    }
    const pending = pendingToolCalls(canonicalMessages);
    if (pending.length > 0) {
      await persistCanonicalReplay();
      return { kind: "tool-calls", toolCalls: pending };
    }

    const runState = classifyCanonicalRun(canonicalMessages);
    if (runState.kind === "awaiting-approval") {
      await persistCanonicalReplay();
      await measureActivityStage("ably.run.suspend", () => run.suspend());
      return {
        kind: "awaiting-approval",
        toolCallIds: approvalToolCallIds(canonicalMessages),
      };
    }
    if (runState.kind === "awaiting-runtime-input") {
      throw ApplicationFailure.nonRetryable(
        "A capability attempted runtime suspension, but the durable product protocol has no resume-data contract.",
        "AGENT_RUNTIME_SUSPENSION_UNSUPPORTED"
      );
    }
    if (runState.kind === "assistant-response-empty") {
      // A previous attempt opened an assistant turn and produced nothing. This
      // branch runs outside the model step, so classify the failure here
      // instead of relying on the catch.
      throw activityFailure(
        inferenceProducedNoOutput(),
        "AGENT_INFERENCE_OUTPUT_MISSING",
        input.sessionName
      );
    }
    if (runState.kind === "assistant-response-complete") {
      // Defence in depth behind the classifier: a completed turn must carry
      // real assistant output no matter how the run was classified.
      if (!hasAssistantOutput(canonicalMessages)) {
        throw activityFailure(
          inferenceProducedNoOutput(),
          "AGENT_INFERENCE_OUTPUT_MISSING",
          input.sessionName
        );
      }
      await persistCanonicalReplay();
      await measureActivityStage("ably.run.end", () => run.end({ reason: "complete" }));
      return { kind: "complete" };
    }

    const causalMessages = selectCausalMessages(canonicalMessages, canonicalState.changedMessages);
    writeAgentCausalContext(requestContext, {
      messageIds: causalMessages.map((message) => message.id),
      attachmentIds: causalAttachmentIds(causalMessages),
    });
    const inferenceTier = classifyInferenceTier(causalMessages);
    writeInferenceTier(requestContext, inferenceTier);
    const step = run.createStep({ stepId: stepIdFor(input.ids.invocationId) });
    let stepStarted = false;
    let settledResponseMessages: UIMessage[] | undefined;
    const controlState: InferenceControlState = {
      approvalToolCallIds: new Set(),
      runtimeSuspensionToolCallIds: new Set(),
    };
    const modelStreamStartedAt = performance.now();
    let recordedFirstOutput = false;

    try {
      await measureActivityStage("ably.step.start", () => step.start());
      stepStarted = true;
      const stepAbort = new AbortController();
      modelStepAbort = stepAbort;
      const result = await measureActivityStage("model.stream.initialize", () =>
        agent.stream(causalMessages, {
          requestContext,
          memory: {
            thread: memoryScope.threadId,
            resource: memoryScope.resourceId,
            // THE single-writer switch. Mastra's runtime gates read the RAW
            // per-call memory options out of the RequestContext, so this is
            // the only placement that works — the same flag on the Memory
            // constructor is ignored by every gate (verified empirically:
            // with only the constructor flag Mastra still wrote orphan
            // assistant rows). readOnly here shuts off every Mastra-side
            // message writer (OM turn persistence, MessageHistory, the
            // onFinish thread/title block whose ai_v4 conversion crashes on
            // fizzdragon-media:// attachments) while history injection and
            // our explicit saveMessages in persistRunMessages stay live.
            // Observational Memory itself is retired in agent-memory.ts:
            // under this readOnly contract it could never observe, and its
            // frozen records made every turn load the entire thread. Bounded
            // MessageHistory injection is the read path readOnly leaves live.
            options: { readOnly: true },
          },
          runId: input.ids.runId,
          maxSteps: 1,
          // Thinking happens entirely before the first output token, so the
          // interactive tier pins an explicit budget here on the per-call
          // options — the only placement Mastra's runtime honours (see the
          // readOnly note above). The reasoning tier keeps dynamic thinking.
          providerOptions: inferenceThinkingProviderOptions(inferenceTier),
          abortSignal: AbortSignal.any([run.abortSignal, stepAbort.signal]),
        })
      );
      // Attach the rejection handler immediately. `step.pipe()` may reject
      // before the response promise is awaited; leaving attribution work on an
      // unobserved promise would turn a correctly classified Activity failure
      // into a process-level unhandled rejection and kill the worker.
      const responseMessagesStatePromise = result.response
        .then(async (response) => {
          // Mastra currently exposes its response UI messages through its
          // bundled AI SDK type. The runtime uses the matching v6 wire
          // contract, and UIMessage is structurally identical at this
          // persistence boundary.
          settledResponseMessages = await measureActivityStage("memory.reconcile-response", () =>
            collectResponseMessagesForRun(
              (response.uiMessages ?? []) as UIMessage[],
              input,
              (messages) => agentMemory.reconcileRunMessages(messages, memoryScope)
            )
          );
          return settledResponseMessages;
        })
        .then<ResponseMessagesState, ResponseMessagesState>(
          (messages) => ({ kind: "fulfilled", messages }),
          (error: unknown) => ({ kind: "rejected", error })
        );
      const uiStream = withCanvasPreview(
        toAISdkStream(result, {
          from: "agent",
          version: "v6",
          sendReasoning: true,
          sendSources: true,
          // Observational Memory events are useful to Mastra's own UI, but are
          // deliberately not part of FizzDragon's stable product protocol.
          experimentalTransform: [
            observeInferenceControl(controlState, () => {
              if (recordedFirstOutput) return;
              recordedFirstOutput = true;
              recordActivityDuration(
                "model.time-to-first-output",
                performance.now() - modelStreamStartedAt,
                "success"
              );
            }),
            stripMastraInternalUiEvents,
          ],
          messageMetadata: () => ({
            conversationId: input.context.conversationId,
            runId: input.ids.runId,
          }),
        }),
        input.ids.runId
      );

      const pipeResult = await measureActivityStage("model.stream-to-terminal", () =>
        step.pipe(uiStream)
      );
      if (!recordedFirstOutput) {
        recordedFirstOutput = true;
        recordActivityDuration(
          "model.time-to-first-output",
          performance.now() - modelStreamStartedAt,
          "failure"
        );
      }
      const steerInterrupted =
        pipeResult.reason === "complete" && stepAbort.signal.aborted && !run.abortSignal.aborted;
      if (steerInterrupted) {
        // An AI SDK provider typically rejects finishReason after an aborted
        // stream. The interruption is expected and belongs to this transport
        // step, not to the Run, so consume it and continue the durable loop.
        void result.finishReason.catch(() => undefined);
        await measureActivityStage("ably.step.end", () => step.end({ reason: "cancelled" }));
        await persistCurrentReplay();
        return { kind: "continue" };
      }
      const outcome = await vercelRunOutcome(
        pipeResult,
        result.finishReason.then(normalizeFinishReason)
      );

      if (outcome.reason === "error") {
        await measureActivityStage("ably.step.end", () => step.end({ reason: "failed" }));
        throw new Error(outcome.error.message);
      }
      if (outcome.reason === "cancelled") {
        await measureActivityStage("ably.step.end", () => step.end({ reason: "cancelled" }));
        await persistCurrentReplay();
        await measureActivityStage("ably.run.end", () => run.end({ reason: "cancelled" }));
        return { kind: "cancelled" };
      }

      // Persist the exact Mastra response identity before asking Ably to
      // finalize the transport step. If Ably's terminal update fails after
      // the provider has produced a valid response, history still contains
      // the answer linked to this durable run and can represent the turn
      // truthfully.
      const responseMessagesState = await responseMessagesStatePromise;
      if (responseMessagesState.kind === "rejected") {
        throw responseMessagesState.error;
      }
      await persistCurrentReplay(responseMessagesState.messages);
      await measureActivityStage("ably.step.end", () => step.end({ reason: "complete" }));

      const authoritativeMessages = mergeMessagesById(
        canonicalMessages,
        responseMessagesState.messages
      );

      if (outcome.reason === "complete") {
        // A steer can arrive while the model is streaming. Do not publish a
        // terminal until every observed input has a durable response step.
        if (run.hasInput()) return { kind: "continue" };
        if (!hasAssistantOutput(authoritativeMessages)) throw inferenceProducedNoOutput();
        await measureActivityStage("ably.run.end", () => run.end({ reason: "complete" }));
        return { kind: "complete" };
      }

      const suspended = classifySuspendedInference(authoritativeMessages, controlState);
      if (suspended.kind === "tool-calls") {
        return suspended;
      }
      if (suspended.kind === "awaiting-approval") {
        await measureActivityStage("ably.run.suspend", () => run.suspend());
        return suspended;
      }
      if (suspended.kind === "runtime-suspension") {
        throw ApplicationFailure.nonRetryable(
          "A capability attempted runtime suspension, but the durable product protocol has no resume-data contract.",
          "AGENT_RUNTIME_SUSPENSION_UNSUPPORTED",
          {
            toolCallIds: suspended.toolCallIds,
          }
        );
      }
      throw ApplicationFailure.nonRetryable(
        "Model generation reported tool suspension without an executable tool call or approval request.",
        "AGENT_INFERENCE_SUSPENSION_INCONSISTENT"
      );
    } catch (error) {
      if (!recordedFirstOutput) {
        recordedFirstOutput = true;
        recordActivityDuration(
          "model.time-to-first-output",
          performance.now() - modelStreamStartedAt,
          "failure"
        );
      }
      // A transport append/recovery error can happen after Mastra has already
      // completed and persisted the model response. Never wait for an
      // unfinished provider stream in the failure path, but preserve an
      // already-settled response so the failure remains attached to its turn.
      if (settledResponseMessages?.length) {
        await persistCurrentReplay(settledResponseMessages);
      }
      if (stepStarted) {
        await bestEffortEndStep(step);
      }
      if (Context.current().cancellationSignal.aborted) throw error;
      if (
        error instanceof AgentAttachmentInputError ||
        error instanceof DomainAttachmentResolutionError
      ) {
        throw activityFailure(error, error.code, input.sessionName);
      }
      throw activityFailure(error, "AGENT_INFERENCE_STEP_FAILED", input.sessionName);
    }

    async function persistCanonicalReplay(): Promise<void> {
      await measureActivityStage("memory.persist-replay", async () => {
        const changed = await agentMemory.reconcileRunMessages(canonicalMessages, memoryScope);
        await agentMemory.persistRunMessages(changed, memoryScope);
      });
    }

    async function persistCurrentReplay(
      responseMessages: ReadonlyArray<UIMessage> = []
    ): Promise<void> {
      const currentMessages = mergeMessagesById(canonicalMessages, responseMessages);
      await measureActivityStage("memory.persist-replay", async () => {
        const changed = await agentMemory.reconcileRunMessages(currentMessages, memoryScope);
        await agentMemory.persistRunMessages(changed, memoryScope);
      });
    }
  } finally {
    modelStepAbort = null;
    await bestEffortReleaseSession(session);
    stopHeartbeat();
  }
}

/**
 * Mastra owns the durable transcript, while the product control plane owns the
 * invocation lifecycle. Persist their shared identity on every message emitted
 * by this Ably Run so a history-only client can reconstruct the turn without
 * guessing from list position.
 *
 * Callers select which messages belong to the Run. The identity checks here are
 * the invariant behind that selection: nothing ever moves between durable runs
 * or conversations, whatever a caller believes.
 */
export function attributeMessagesToRun(
  messages: ReadonlyArray<UIMessage>,
  input: Pick<RunActivityInput, "ids" | "context">
): UIMessage[] {
  return messages.map((message) => {
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    assertMessageConversationIdentity(message, input);
    const existingRunId = metadata.runId;
    if (typeof existingRunId === "string" && existingRunId !== input.ids.runId) {
      throw ApplicationFailure.nonRetryable(
        `Agent message ${message.id} belongs to a different run.`,
        "AGENT_MESSAGE_RUN_IDENTITY_MISMATCH"
      );
    }
    return {
      ...message,
      metadata: {
        ...metadata,
        conversationId: input.context.conversationId,
        runId: input.ids.runId,
      },
    };
  });
}

type ResponseMessagesState =
  | Readonly<{ kind: "fulfilled"; messages: UIMessage[] }>
  | Readonly<{ kind: "rejected"; error: unknown }>;

export type CanonicalRunMessagesState = Readonly<{
  messages: UIMessage[];
  changedMessages: UIMessage[];
}>;

/**
 * An Ably session is conversation-scoped, so a newly adopted Run can observe
 * immutable messages from earlier Runs in the same channel. Those rows are
 * legitimate model history, but they are not mutable members of the current
 * durable Run and must never be re-attributed to it.
 *
 * Durable run identity on the message is the ownership witness, and it outranks
 * the storage delta. Reconciliation cannot witness ownership: a transport
 * replay carries no framework part timestamps, so comparing it against the
 * stored row reports a change that never happened. Deciding ownership from that
 * delta turns every replayed prior-run message into a dead turn.
 * - a message carrying another runId is established history and is excluded
 *   from the current Run;
 * - a current-run message is retained even when already persisted (Activity
 *   retry);
 * - a message without run identity is this Run's own content when the storage
 *   delta reports it as new or changed.
 *
 * Conversation identity is a different class of claim: no legitimate message
 * ever names another conversation, so that mismatch still fails loudly.
 */
export async function collectCanonicalMessagesForRun(
  messages: ReadonlyArray<UIMessage>,
  input: Pick<RunActivityInput, "ids" | "context">,
  reconcile: (messages: ReadonlyArray<UIMessage>) => Promise<UIMessage[]>
): Promise<CanonicalRunMessagesState> {
  const changedMessages = await reconcile(messages);
  const changedIds = new Set(changedMessages.map((message) => message.id));
  const currentMessages = messages.filter((message) => {
    assertMessageConversationIdentity(message, input);
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const existingRunId = metadata.runId;
    if (typeof existingRunId === "string") return existingRunId === input.ids.runId;
    // Unowned, unchanged rows are legacy history. Only a new/changed row can
    // become input for this Run.
    return changedIds.has(message.id);
  });
  const attributed = attributeMessagesToRun(currentMessages, input);
  const attributedById = new Map(attributed.map((message) => [message.id, message]));
  return {
    messages: attributed,
    changedMessages: changedMessages.flatMap((message) => {
      const current = attributedById.get(message.id);
      return current ? [current] : [];
    }),
  };
}

/**
 * Mastra's response list is not a delta. A previously persisted message with
 * `metadata.mastra.responseBoundary` can be returned beside the current
 * response — Observational Memory reliably replays the preceding run's boundary
 * message — so treating the full list as this run's output would move history
 * between durable runs.
 *
 * Durable run identity decides ownership here for the same reason it does on
 * the input side: the storage delta cannot witness it. A replayed row is
 * re-stamped with fresh framework part timestamps on its way through Mastra's
 * message list, so reconciliation reports an untouched historical row as
 * changed. Messages already carrying this run's identity are retained even if
 * Mastra auto-persisted them before the response promise resolved, allowing
 * this boundary to remove framework-only metadata deterministically.
 */
export async function collectResponseMessagesForRun(
  messages: ReadonlyArray<UIMessage>,
  input: Pick<RunActivityInput, "ids" | "context">,
  reconcile: (messages: ReadonlyArray<UIMessage>) => Promise<UIMessage[]>
): Promise<UIMessage[]> {
  const changedMessages = await reconcile(messages);
  const changedIds = new Set(changedMessages.map((message) => message.id));
  const currentMessages = messages.filter((message) => {
    assertMessageConversationIdentity(message, input);
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    const existingRunId = metadata.runId;
    if (typeof existingRunId === "string") return existingRunId === input.ids.runId;
    return changedIds.has(message.id);
  });
  return attributeMessagesToRun(projectProductUiMessages(currentMessages), input);
}

function assertMessageConversationIdentity(
  message: UIMessage,
  input: Pick<RunActivityInput, "context">
): void {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  const existingConversationId = metadata.conversationId;
  if (
    typeof existingConversationId === "string" &&
    existingConversationId !== input.context.conversationId
  ) {
    throw ApplicationFailure.nonRetryable(
      `Agent message ${message.id} belongs to a different conversation.`,
      "AGENT_MESSAGE_CONVERSATION_IDENTITY_MISMATCH"
    );
  }
}

function normalizeFinishReason(reason: string | undefined): FinishReason {
  if (
    reason === "stop" ||
    reason === "length" ||
    reason === "content-filter" ||
    reason === "tool-calls" ||
    reason === "other"
  ) {
    return reason;
  }
  throw new Error(`Model generation ended with non-terminal reason: ${reason ?? "missing"}`);
}

export async function executeToolActivity(input: ToolActivityInput): Promise<void> {
  const stopHeartbeat = beginActivityHeartbeat(`tool:${input.toolName}`);
  const { config, domainGateway } = getRuntimeDependencies();
  const client = acquireAgentAblyClient(config.ablyApiKey);
  const session = createAgentSession({
    client,
    channelName: input.sessionName,
    historyPageSize: AGENT_HISTORY_PAGE_SIZE,
  });
  const run = session.adoptRun(input.ids, {
    signal: Context.current().cancellationSignal,
  });

  try {
    await measureActivityStage("ably.session.connect", () => connectAgentSession(client, session));
    // Priming only; no boundary walk. This activity publishes tool output and
    // never reads `run.messages`, so load()'s own fold suffices.
    await measureActivityStage("ably.run.load", async () => {
      await primeAdoptedRunFold(run, session.tree);
      await run.load();
    });
    const definition = getAuthorizedToolDefinition(input.context, input.toolName);
    const step = run.createStep({
      stepId: stepIdFor(input.ids.invocationId),
    });
    let stepStarted = false;

    try {
      await measureActivityStage("ably.step.start", () => step.start());
      stepStarted = true;
      const output = await measureActivityStage("domain.tool.execute", executeDefinition);
      await measureActivityStage("ably.tool-output.publish", () =>
        step.send({
          type: "tool-output-available",
          toolCallId: input.toolCallId,
          output,
        })
      );
      await measureActivityStage("ably.step.end", () => step.end({ reason: "complete" }));
    } catch (error) {
      if (stepStarted) await bestEffortEndStep(step);
      throw error;
    }

    async function executeDefinition(): Promise<DomainToolResult> {
      try {
        const parsedArguments = definition.inputSchema.parse(input.arguments);
        return await definition.execute({
          arguments: parsedArguments,
          context: input.context,
          idempotencyKey: `${input.ids.runId}:${input.toolCallId}`,
          gateway: domainGateway,
          signal: run.abortSignal,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          return {
            status: "rejected",
            error: {
              code: "AGENT_TOOL_INPUT_INVALID",
              message: "The tool arguments did not satisfy the capability contract.",
              retryable: false,
              details: error.issues.map((issue) => ({
                path: issue.path,
                message: issue.message,
              })),
            },
          };
        }
        throw error;
      }
    }
  } catch (error) {
    if (Context.current().cancellationSignal.aborted) throw error;
    if (error instanceof CapabilityDeniedError) {
      throw activityFailure(error, "AGENT_CAPABILITY_DENIED", input.sessionName);
    }
    if (error instanceof DomainGatewayUnavailableError) {
      throw activityFailure(error, "DOMAIN_GATEWAY_UNAVAILABLE", input.sessionName);
    }
    throw activityFailure(error, "AGENT_TOOL_STEP_FAILED", input.sessionName);
  } finally {
    await bestEffortReleaseSession(session);
    stopHeartbeat();
  }
}

export async function endRunActivity(input: EndRunInput): Promise<void> {
  const stopHeartbeat = beginActivityHeartbeat(`end-run:${input.reason}`);
  const { config } = getRuntimeDependencies();
  const client = acquireAgentAblyClient(config.ablyApiKey);
  const session = createAgentSession({
    client,
    channelName: input.sessionName,
    historyPageSize: AGENT_HISTORY_PAGE_SIZE,
  });
  const run = session.adoptRun(input.ids);

  try {
    await measureActivityStage("ably.session.connect", () => connectAgentSession(client, session));
    try {
      // Priming folds the same wires load() would; a terminal run still
      // surfaces through load()'s InvalidArgument rejection below.
      await measureActivityStage("ably.run.load", async () => {
        await primeAdoptedRunFold(run, session.tree);
        await run.load();
      });
    } catch (error) {
      // AdoptedRun.load() deliberately rejects terminal runs. Its live status
      // is the authoritative idempotency check for a retried cleanup Activity.
      if (
        error instanceof Ably.ErrorInfo &&
        errorInfoIs(error, ErrorCode.InvalidArgument) &&
        (run.status === "complete" || run.status === "cancelled" || run.status === "error")
      ) {
        return;
      }
      throw error;
    }
    if (input.reason === "cancelled") {
      await measureActivityStage("ably.run.end", () => run.end({ reason: "cancelled" }));
      return;
    }
    await measureActivityStage("ably.run.end", () =>
      run.end({
        reason: "error",
        error: input.error ? toAblyError(input.error.code, input.error.message) : undefined,
      })
    );
  } catch (error) {
    if (Context.current().cancellationSignal.aborted) throw error;
    throw activityFailure(error, "AGENT_RUN_END_FAILED", input.sessionName);
  } finally {
    await bestEffortReleaseSession(session);
    stopHeartbeat();
  }
}

export async function reportInvocationLifecycleActivity(
  input: AgentInvocationLifecycleProjection
): Promise<void> {
  const stopHeartbeat = beginActivityHeartbeat(`invocation-lifecycle:${input.status}`);
  const { domainGateway } = getRuntimeDependencies();
  try {
    await measureActivityStage("domain.lifecycle.report", () =>
      domainGateway.reportInvocationLifecycle({
        lifecycle: {
          invocationId: input.invocationId,
          attemptId: input.attemptId,
          attemptOrdinal: input.attemptOrdinal,
          conversationId: input.context.conversationId,
          runId: input.runId,
          status: input.status,
          error: input.error,
        },
        traceId: input.context.traceId,
        signal: Context.current().cancellationSignal,
      })
    );
  } catch (error) {
    if (Context.current().cancellationSignal.aborted) throw error;
    throw activityFailure(error, "DOMAIN_GATEWAY_UNAVAILABLE", input.context.sessionName);
  } finally {
    stopHeartbeat();
  }
}

const RUN_HYDRATION_TIMEOUT_MS = 30_000;

/**
 * The transport settles `located` (and its internal located flag) on a fixed
 * promise-chain depth after the history fold that matches the trigger. Folding
 * itself is synchronous inside a `loadOlder` page, so a caller that re-checks
 * state immediately after the fold observes the pre-fold world and fetches a
 * page it does not need. A bounded microtask drain lets those continuations
 * run; the bound only needs to cover the chain depth, not any I/O.
 */
async function settleFoldObservers(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
}

type RunHistoryDriver = Readonly<{
  runId: string;
  located: Promise<void>;
  abortSignal: AbortSignal;
  view: {
    hasOlder(): boolean;
    loadOlder(limit?: number): Promise<unknown>;
  };
}>;

type ConversationTreeReader = Readonly<{
  getRunNode(runId: string):
    | Readonly<{
        startSerial: string | undefined;
        parentCodecMessageId: string | undefined;
      }>
    | undefined;
  getNodeByCodecMessageId(codecMessageId: string): unknown;
}>;

async function locateCreatedRun(run: Omit<RunHistoryDriver, "runId">): Promise<void> {
  let located = false;
  let locationError: unknown;
  void run.located.then(
    () => {
      located = true;
    },
    (error: unknown) => {
      locationError = error;
    }
  );

  const deadline = Date.now() + RUN_HYDRATION_TIMEOUT_MS;
  // A trigger that arrived live during connect has already folded; without the
  // drain its settled `located` chain is unobservable before the first
  // synchronous loop pass and the loop pays a history fetch to learn it.
  await settleFoldObservers();
  while (!located && !locationError && run.view.hasOlder()) {
    if (run.abortSignal.aborted) throw run.abortSignal.reason;
    if (Date.now() >= deadline) break;
    // Reveal quota 1: folding — which is what locates the trigger — advances
    // one full history page per fetch regardless of the reveal quota, so the
    // smallest quota drives the fewest page fetches. The old quota of 50
    // forced the hydrator to keep paging until 50 branch messages were
    // revealed, long after the trigger (the newest wire) had folded on the
    // first page — a cost that grew with conversation length.
    await run.view.loadOlder(1);
    await settleFoldObservers();
  }
  if (locationError) throw locationError;
  if (located) return;

  const remainingMs = Math.max(1, deadline - Date.now());
  await Promise.race([
    run.located,
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("The Ably invocation input was not observable within 30 seconds"));
      }, remainingMs);
      timeout.unref();
      void run.located.then(
        () => clearTimeout(timeout),
        () => clearTimeout(timeout)
      );
    }),
  ]);
}

/**
 * Best-effort pre-fold so `AdoptedRun.load()` takes its already-observed fast
 * path. load()'s fold predicate needs the run-start fold AND the settled
 * `located` chain, but the transport's fold loop checks the predicate
 * synchronously after each page — before the microtask that settles `located`
 * can run — so once the channel exceeds one history page, load() always
 * fetches one full wasted page (measured as `ably.run.load` growing from
 * ~290ms to 1.3-2.0s with conversation length). Driving the same fold through
 * the view with a drain between pages observes the predicate at the earliest
 * page. Never throws: on abort, exhaustion, or deadline it returns and leaves
 * every load() contract — the 30s InputEventNotFound timeout, terminal-run
 * rejection, cancellation — to load() itself.
 */
async function primeAdoptedRunFold(
  run: RunHistoryDriver,
  tree: ConversationTreeReader
): Promise<void> {
  let locationSettled = false;
  void run.located.then(
    () => {
      locationSettled = true;
    },
    () => {
      locationSettled = true;
    }
  );
  const primed = () => locationSettled && tree.getRunNode(run.runId)?.startSerial !== undefined;

  const deadline = Date.now() + RUN_HYDRATION_TIMEOUT_MS;
  await settleFoldObservers();
  while (!primed() && run.view.hasOlder()) {
    if (run.abortSignal.aborted || Date.now() >= deadline) return;
    await run.view.loadOlder(1);
    await settleFoldObservers();
  }
}

/**
 * Fold an adopted Run back to its own boundary — its parent input node — so
 * `run.messages` is complete before any canonical read.
 *
 * History folds contiguously backwards from the attach point, so once the
 * Run's parent input node is in the Tree every wire newer than it — the Run's
 * entire extent, including a suspended turn's assistant message with pending
 * tool-call parts and every steer — has folded too. That bounds the walk by
 * the active Run itself rather than by a fixed page or reveal count: a fresh
 * run's parent is the just-located trigger (zero extra fetches), while an
 * approval continuation whose suspension lies arbitrarily many wires deep
 * pages exactly as far as its own turn extends. The previous fixed reveal
 * quota of 50 could silently under-read exactly that adoption case.
 *
 * Exhausted history (hasOlder() false) exits the walk and leaves the failure
 * mode to the canonical classifiers, identical to today's truncated-history
 * behavior.
 */
async function hydrateAdoptedRunBoundary(
  run: Omit<RunHistoryDriver, "located">,
  tree: ConversationTreeReader
): Promise<void> {
  const boundaryFolded = () => {
    const node = tree.getRunNode(run.runId);
    if (!node) return false;
    if (node.parentCodecMessageId === undefined) return true;
    return tree.getNodeByCodecMessageId(node.parentCodecMessageId) !== undefined;
  };

  const deadline = Date.now() + RUN_HYDRATION_TIMEOUT_MS;
  while (!boundaryFolded() && run.view.hasOlder()) {
    if (run.abortSignal.aborted) throw run.abortSignal.reason;
    if (Date.now() >= deadline) break;
    await run.view.loadOlder(1);
  }
}

export function selectCausalMessages(
  canonicalMessages: ReadonlyArray<UIMessage>,
  changedMessages: ReadonlyArray<UIMessage>
): UIMessage[] {
  const originatingInput =
    canonicalMessages.findLast((message) => message.role === "user") ??
    canonicalMessages.findLast((message) => message.role === "assistant");
  if (!originatingInput) {
    throw ApplicationFailure.nonRetryable(
      "The active Ably run has no causal input.",
      "AGENT_CONVERSATION_EMPTY"
    );
  }

  const causalIds = new Set([originatingInput.id, ...changedMessages.map((message) => message.id)]);
  return canonicalMessages.filter((message) => causalIds.has(message.id));
}

export function causalAttachmentIds(messages: ReadonlyArray<UIMessage>): string[] {
  const attachmentIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      const record = part as unknown as Record<string, unknown>;
      for (const value of [record.url, record.uri, record.data]) {
        const raw = value instanceof URL ? value.toString() : value;
        if (typeof raw !== "string") continue;
        try {
          const url = new URL(raw);
          if (
            url.protocol === "fizzdragon-media:" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
              url.hostname
            )
          ) {
            attachmentIds.add(url.hostname);
          }
        } catch {
          // Canonical attachment validation happens in the model processor.
        }
      }
    }
  }
  return [...attachmentIds];
}

export function mergeMessagesById(
  ...messageGroups: ReadonlyArray<ReadonlyArray<UIMessage>>
): UIMessage[] {
  const messagesById = new Map<string, UIMessage>();
  for (const messages of messageGroups) {
    for (const message of messages) {
      messagesById.set(message.id, message);
    }
  }
  return [...messagesById.values()];
}

/**
 * Retryable on purpose. A model step that returns no text, no tool call and no
 * approval request is usually transient — a live "你好呀" turn came back with
 * `text: ""`, `toolCalls: []` and 378 output tokens that were all reasoning
 * tokens, well under any budget, so nothing was truncated and nothing was
 * wrong with the request. Failing that immediately turns a blip into an error
 * card, which is the opposite over-correction to the silent success this guard
 * replaced. The Activity's retry policy gets to try again; only an empty result
 * that survives the whole attempt budget reaches the creator.
 */
function inferenceProducedNoOutput(): ApplicationFailure {
  return ApplicationFailure.retryable(
    "The model step ended without producing any assistant output.",
    "AGENT_INFERENCE_OUTPUT_MISSING"
  );
}

export function classifySuspendedInference(
  messages: ReadonlyArray<UIMessage>,
  controlState: Pick<InferenceControlState, "approvalToolCallIds" | "runtimeSuspensionToolCallIds">
): SuspendedInferenceClassification {
  const canonicalState = classifyCanonicalRun(messages);
  if (
    canonicalState.kind === "awaiting-runtime-input" ||
    controlState.runtimeSuspensionToolCallIds.size > 0
  ) {
    return {
      kind: "runtime-suspension",
      toolCallIds: [...controlState.runtimeSuspensionToolCallIds],
    };
  }

  const toolCalls = pendingToolCalls(messages);
  if (toolCalls.length > 0) {
    return { kind: "tool-calls", toolCalls };
  }

  if (canonicalState.kind === "awaiting-approval" || controlState.approvalToolCallIds.size > 0) {
    return {
      kind: "awaiting-approval",
      toolCallIds: uniqueStrings([
        ...approvalToolCallIds(messages),
        ...controlState.approvalToolCallIds,
      ]),
    };
  }

  return { kind: "inconsistent" };
}

/**
 * Temporal can retry after Ably accepted the terminal update but before the
 * Activity completion reached the server. `AdoptedRun.load()` rejects an
 * already-terminal Run, so translate that authoritative status back into the
 * same idempotent workflow outcome instead of retrying model inference.
 */
export function recoverTerminalInferenceResult(
  error: unknown,
  status: string
): InferenceActivityResult | undefined {
  if (!(error instanceof Ably.ErrorInfo) || !errorInfoIs(error, ErrorCode.InvalidArgument)) {
    return undefined;
  }
  if (status === "complete") return { kind: "complete" };
  if (status === "cancelled") return { kind: "cancelled" };
  if (status === "error") {
    throw ApplicationFailure.nonRetryable(
      "The Ably run was already terminal with an error.",
      "AGENT_RUN_ALREADY_FAILED"
    );
  }
  return undefined;
}

function approvalToolCallIds(messages: ReadonlyArray<UIMessage>): string[] {
  const lastAssistant = messages.findLast((message) => message.role === "assistant");
  if (!lastAssistant) return [];
  return uniqueStrings(
    lastAssistant.parts.flatMap((part) =>
      isToolUIPart(part) && part.state === "approval-requested" ? [part.toolCallId] : []
    )
  );
}

function uniqueStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function observeInferenceControl(
  state: InferenceControlState,
  onFirstOutput: () => void
): MastraStreamTransform {
  return () =>
    new TransformStream({
      transform(chunk, controller) {
        if (isMeaningfulModelOutput(chunk.type)) onFirstOutput();
        if (chunk.type === "tool-call-approval") {
          state.approvalToolCallIds.add(chunk.payload.toolCallId);
        } else if (chunk.type === "tool-call-suspended") {
          state.runtimeSuspensionToolCallIds.add(chunk.payload.toolCallId);
        }
        controller.enqueue(chunk);
      },
    });
}

function isMeaningfulModelOutput(type: string): boolean {
  return (
    type === "text-delta" ||
    type === "reasoning-delta" ||
    type === "tool-call" ||
    type === "tool-call-approval" ||
    type === "tool-call-suspended"
  );
}

async function bestEffortReleaseSession(session: { detach(): Promise<void> }): Promise<void> {
  try {
    await measureActivityStage("ably.session.detach", () => releaseAgentSession(session));
  } catch {
    Context.current().log.warn("Unable to detach an Agent Transport session");
  }
}

async function bestEffortEndStep(step: {
  end(params: { reason: "failed" }): Promise<void>;
}): Promise<void> {
  try {
    await step.end({ reason: "failed" });
  } catch {
    // The workflow cleanup activity is the final lifecycle guarantee.
  }
}

async function bestEffortEndRun(
  run: {
    end(params: { reason: "error"; error?: Ably.ErrorInfo }): Promise<void>;
  },
  params: { reason: "error"; error: Ably.ErrorInfo }
): Promise<void> {
  try {
    await run.end(params);
  } catch {
    // Preserve the original opening failure for Temporal retry classification.
  }
}

function toAblyError(code: string, message: string): Ably.ErrorInfo {
  return new Ably.ErrorInfo(`${code}: ${message}`, ErrorCode.StreamError, 500);
}

function activityFailure(
  error: unknown,
  fallbackType: string,
  channelName: string
): ApplicationFailure {
  const publicError = publicActivityError(error, fallbackType, channelName);
  Context.current().log.error("Agent Platform Activity failed", {
    diagnosticId: publicError.diagnosticId,
    publicCode: publicError.code,
    fallbackType,
    // Raw dependency/provider details are intentionally telemetry-only. They
    // are never copied into Temporal public details, Ably, or product state.
    error,
  });
  const details = applicationFailureDetailsFor(publicError);
  return publicError.retryable
    ? ApplicationFailure.retryable(publicError.message, publicError.code, details)
    : ApplicationFailure.nonRetryable(publicError.message, publicError.code, details);
}

function publicActivityError(
  error: unknown,
  fallbackType: string,
  channelName: string
): AgentPublicError {
  const transportFailure = classifyAgentTransportFailure(error, channelName);
  return createAgentPublicError({
    error,
    fallbackCode: fallbackType,
    diagnosticId: randomUUID(),
    code: transportFailure?.type,
    retryable: transportFailure?.retryable,
  });
}

export const AGENT_ACTIVITY_HEARTBEAT_INTERVAL_MS = 500;

function beginActivityHeartbeat(phase: string): () => void {
  const context = Context.current();
  context.heartbeat({ phase });
  const timer = setInterval(
    () => context.heartbeat({ phase }),
    AGENT_ACTIVITY_HEARTBEAT_INTERVAL_MS
  );
  timer.unref();
  return () => clearInterval(timer);
}

async function measureActivityStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    recordActivityDuration(stage, performance.now() - startedAt, "success");
    return result;
  } catch (error) {
    recordActivityDuration(stage, performance.now() - startedAt, "failure");
    throw error;
  }
}

function recordActivityDuration(
  stage: string,
  durationMs: number,
  outcome: "success" | "failure"
): void {
  const context = Context.current();
  const normalizedDurationMs = Math.max(0, durationMs);
  context.metricMeter
    .createHistogram(
      "fizzdragon_agent_stage_duration",
      "float",
      "ms",
      "Duration of a privacy-safe Agent Platform Activity stage"
    )
    .record(normalizedDurationMs, { stage, outcome });
  context.log.debug("Agent Platform Activity stage completed", {
    stage,
    outcome,
    durationMs: Math.round(normalizedDurationMs * 100) / 100,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
