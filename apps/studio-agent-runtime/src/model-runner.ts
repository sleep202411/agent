import { createAlibaba } from "@ai-sdk/alibaba";
import { studioAgentProviderToolName as providerToolName } from "@repo/shared/studio-agent-tools";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentEventDraftSchema,
  StudioAgentJsonObjectSchema,
  StudioAgentModelStepOutcomeSchema,
  type StudioAgentAssistantSegmentOutput,
  type StudioAgentCapabilityManifest,
  type StudioAgentCapabilityPermission,
  type StudioAgentChildRunPreparation,
  type StudioAgentContextCompactionModelExecutionPlan,
  type StudioAgentError,
  type StudioAgentEventDraft,
  type StudioAgentJsonObject,
  type StudioAgentModelExecutionPlan,
  type StudioAgentModelMessageJson,
  type StudioAgentModelStepOutcome,
  type StudioAgentPlannedCapability,
  type StudioAgentPreparedAction,
  type StudioAgentPrepareActionRequest,
  type StudioAgentResponseModelExecutionPlan,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";
import type {
  StudioAgentActivityPart,
  StudioAgentFailurePart,
} from "@repo/shared/studio-agent-transport";
import type { StreamResult } from "@ably/ai-transport";
import { vercelRunOutcome, type VercelRunOutcome } from "@ably/ai-transport/vercel";
import {
  generateText,
  jsonSchema,
  streamText,
  tool,
  type AssistantContent,
  type FinishReason,
  type ModelMessage,
  type Tool,
  type ToolContent,
  type UserContent,
} from "ai";
import {
  activityChunk,
  failureChunk,
  type StudioAgentUIChunk,
  type StudioAgentUIMessage,
} from "./agent-session.js";
import type { RuntimeModelConfig } from "./config.js";
import type { StudioAgentRuntimeGateway } from "./gateway-client.js";

/**
 * The delivery half of one model step, or null when the run has no channel.
 *
 * A TASK run carries null: it has no triggering input event, so it has no
 * identity on the conversation channel (see `StudioAgentDeliveryTrigger`). Its
 * output is durable-only and reaches the browser through the snapshot
 * endpoint. This is not a fallback — it is the absence of a thing the wire has
 * no shape for.
 */
export interface ModelStepDelivery {
  /** The transport step's id. Stable across a cross-process retry, so a retry
   *  SUPERSEDES the dead attempt's output instead of appending beside it. */
  readonly stepId: string;
  pipe(stream: ReadableStream<StudioAgentUIChunk>): Promise<StreamResult>;
  send(chunk: StudioAgentUIChunk): Promise<void>;
}

interface ModelRunObserver {
  signal: AbortSignal;
  heartbeat(details: unknown): void;
  now(): Date;
}

export interface ModelRunnerDependencies {
  gateway: StudioAgentRuntimeGateway;
  config: RuntimeModelConfig;
  observer: ModelRunObserver;
  delivery: ModelStepDelivery | null;
}

interface ToolBinding {
  providerName: string;
  capability: StudioAgentCapabilityManifest;
  permission: StudioAgentCapabilityPermission;
}

type ModelToolResultPart = Extract<ToolContent[number], { type: "tool-result" }>;

export async function runQwenModelStep(
  workflow: StudioAgentWorkflowInput,
  dependencies: ModelRunnerDependencies
): Promise<StudioAgentModelStepOutcome> {
  for (;;) {
    const plan = await dependencies.gateway.loadModelPlan(workflow, dependencies.observer.signal);
    validatePlanAgainstRuntime(plan, dependencies.config);
    if (plan.kind === "context_compaction") {
      await runContextCompaction(workflow, plan, dependencies);
      continue;
    }
    return runResponseModelStep(workflow, plan, dependencies);
  }
}

async function runResponseModelStep(
  workflow: StudioAgentWorkflowInput,
  plan: StudioAgentResponseModelExecutionPlan,
  dependencies: ModelRunnerDependencies
): Promise<StudioAgentModelStepOutcome> {
  const { gateway, config, observer, delivery } = dependencies;

  const activityId = plan.context.stepId;
  const startedAt = observer.now();
  const bindings = createToolBindings(plan.capabilities);
  const tools = createCapabilityTools(bindings);
  const provider = createAlibaba({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    includeUsage: true,
  });

  const activityLabel = "studio_agent.activity.generating_response";
  let activityStarted = false;
  let activityTerminal = false;
  let segmentStarted = false;
  let segmentTerminal = false;
  let content = "";
  let providerResponseId: string | null = null;
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: null as number | null,
    reasoningTokens: null as number | null,
  };

  try {
    await gateway.appendEvent(
      eventDraft(
        workflow,
        "activity.started",
        {
          activityId,
          parentActivityId: null,
          kind: "generate",
          // Durable activity events carry a stable semantic key. Each host
          // surface localizes it at render time instead of freezing whichever
          // locale happened to execute the workflow.
          label: activityLabel,
          startedAt: startedAt.toISOString(),
        },
        `model:${plan.context.stepId}:activity:started`,
        startedAt
      ),
      observer.signal
    );
    activityStarted = true;
    await publishActivity(delivery, {
      activityId,
      kind: "generate",
      label: activityLabel,
      status: "running",
      detail: null,
      progress: null,
      startedAt: startedAt.toISOString(),
      completedAt: null,
    });
    await gateway.appendEvent(
      eventDraft(
        workflow,
        "assistant.segment.started",
        {
          messageId: plan.assistantMessageId,
          segmentId: plan.segmentId,
          ordinal: 0,
          kind: "answer",
          format: "markdown",
        },
        `model:${plan.context.stepId}:segment:${plan.segmentId}:started`,
        observer.now()
      ),
      observer.signal
    );
    segmentStarted = true;

    const result = streamText({
      model: provider(plan.modelId),
      system: plan.system,
      messages: toModelMessages(plan.messages),
      tools,
      maxRetries: 0,
      maxOutputTokens: plan.maxOutputTokens,
      timeout: plan.timeoutMs,
      abortSignal: observer.signal,
      toolChoice: plan.capabilities.length === 0 ? "none" : "auto",
    });

    // THE MESSAGE ID IS OURS, NOT THE SDK'S.
    //
    // The browser seeds its conversation from `GET threads/:id/snapshot`
    // (StudioAgentMessage rows) and then follows the channel. The two only
    // reconcile if they agree on one id — the transport's internal
    // `codecMessageId` is never persisted, so the domain `message.id` is the
    // only key shared by both stores. Seeding the generator with the assistant
    // message the control plane already allocated is what makes seed and live
    // the same message instead of two.
    const uiStream = result.toUIMessageStream<StudioAgentUIMessage>({
      generateMessageId: () => plan.assistantMessageId,
      messageMetadata: () => ({
        threadId: workflow.threadId,
        runId: workflow.runId,
        rootRunId: workflow.rootRunId,
        parentRunId: workflow.parentRunId,
        kind: workflow.kind,
      }),
    });

    const outcome = await consumeModelStream(result, uiStream, delivery);
    if (outcome.reason === "error") {
      throw new Error(outcome.error.message);
    }
    if (outcome.reason === "cancelled") {
      throw new Error("The model stream was cancelled.");
    }

    content = await result.text;
    const totalUsage = await result.totalUsage;
    usage = {
      inputTokens: totalUsage.inputTokens ?? 0,
      outputTokens: totalUsage.outputTokens ?? 0,
      cachedInputTokens: totalUsage.inputTokenDetails.cacheReadTokens ?? null,
      reasoningTokens: totalUsage.outputTokenDetails.reasoningTokens ?? null,
    };
    providerResponseId = (await result.response).id ?? null;
    // Only a hard output-token truncation changes the disposition; every other
    // clean end (plain stop, or a stop that emitted tool calls) is a normal
    // completion. Provider errors and aborts are already terminal above.
    const finishReason: "stop" | "length" =
      (await result.finishReason) === "length" ? "length" : "stop";

    const toolCalls: Array<{
      toolCallId: string;
      providerName: string;
      input: StudioAgentJsonObject;
    }> = [];
    for (const call of await result.toolCalls) {
      if (call.invalid) {
        throw new Error(`Model emitted an invalid tool call for ${call.toolName}.`, {
          cause: call.error,
        });
      }
      toolCalls.push({
        toolCallId: call.toolCallId,
        providerName: call.toolName,
        input: StudioAgentJsonObjectSchema.parse(call.input),
      });
    }

    const preparedActions: StudioAgentPreparedAction[] = [];
    // Both outcomes of a `child_run` prepare belong here: a started delegation
    // the workflow must run, and a refused one it must not. A refusal is already
    // a terminal `failed` action on the control plane, so it needs no execution
    // — but it still counts as work this step produced, which keeps the
    // directive on `continue` and gives the model the step in which it reads the
    // rejection and corrects the call.
    const childRuns: StudioAgentChildRunPreparation[] = [];
    for (const call of toolCalls) {
      const binding = bindings.find((candidate) => candidate.providerName === call.providerName);
      if (!binding) {
        throw new Error(`Model called an unregistered tool ${call.providerName}.`);
      }
      const request: StudioAgentPrepareActionRequest = {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        threadId: workflow.threadId,
        runId: workflow.runId,
        stepId: plan.context.stepId,
        toolCallId: call.toolCallId,
        name: binding.capability.capabilityId,
        input: call.input,
      };
      if (binding.capability.executionMode === "child_run") {
        childRuns.push(await gateway.prepareChildRun(request, observer.signal));
      } else {
        preparedActions.push(await gateway.prepareAction(request, observer.signal));
      }
    }

    const completedAt = observer.now();
    await gateway.appendEvent(
      eventDraft(
        workflow,
        "assistant.segment.completed",
        {
          messageId: plan.assistantMessageId,
          segmentId: plan.segmentId,
          content,
          finishReason,
          providerResponseId,
          usage,
          completedAt: completedAt.toISOString(),
        },
        `model:${plan.context.stepId}:segment:${plan.segmentId}:terminal`,
        completedAt
      ),
      observer.signal
    );
    segmentTerminal = true;
    await gateway.appendEvent(
      eventDraft(
        workflow,
        "activity.completed",
        {
          activityId,
          summary: null,
          completedAt: completedAt.toISOString(),
        },
        `model:${plan.context.stepId}:activity:terminal`,
        completedAt
      ),
      observer.signal
    );
    activityTerminal = true;
    await publishActivity(delivery, {
      activityId,
      kind: "generate",
      label: activityLabel,
      status: "succeeded",
      detail: null,
      progress: null,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });

    const assistantSegments: StudioAgentAssistantSegmentOutput[] = [
      {
        segmentId: plan.segmentId,
        ordinal: 0,
        kind: "answer",
        format: "markdown",
        content,
      },
    ];
    return StudioAgentModelStepOutcomeSchema.parse({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      stepId: plan.context.stepId,
      providerResponseId,
      assistantSegments,
      preparedActions,
      childRuns,
      directive: stepDirective(preparedActions, childRuns),
      usage,
      completedAt: completedAt.toISOString(),
    });
  } catch (error) {
    const failedAt = observer.now();
    const cancelled = observer.signal.aborted;
    const errorRecord = toStudioAgentError(error, cancelled);
    await appendFailureEvents({
      gateway,
      workflow,
      plan,
      activityId,
      content,
      failedAt,
      errorRecord,
      cancelled,
      providerResponseId,
      usage,
      activityStarted,
      activityTerminal,
      segmentStarted,
      segmentTerminal,
    });
    if (activityStarted && !activityTerminal) {
      await publishActivity(delivery, {
        activityId,
        kind: "generate",
        label: activityLabel,
        status: cancelled ? "cancelled" : "failed",
        detail: cancelled ? null : errorRecord.message.slice(0, 2_000),
        progress: null,
        startedAt: startedAt.toISOString(),
        completedAt: failedAt.toISOString(),
      });
    }
    if (!cancelled) {
      // `Ably.ErrorInfo` on `ai-run-end` is `{code: number, message}`. Our
      // failure surface distinguishes `studio_agent.invalid_action_input` from
      // `studio_agent.capability_result_invalid` by a STRING code and renders
      // `details.issues` paths, neither of which survives a numeric code — so
      // the honest error travels as its own part.
      await publishFailure(delivery, {
        runId: workflow.runId,
        error: errorRecord,
        failedAt: failedAt.toISOString(),
      });
    }
    throw error;
  }
}

async function runContextCompaction(
  workflow: StudioAgentWorkflowInput,
  plan: StudioAgentContextCompactionModelExecutionPlan,
  dependencies: ModelRunnerDependencies
): Promise<void> {
  const { gateway, config, observer } = dependencies;
  const startedAt = observer.now();
  await gateway.appendEvent(
    eventDraft(
      workflow,
      "activity.started",
      {
        activityId: plan.compaction.activityId,
        parentActivityId: null,
        kind: "analyze",
        label: plan.context.locale.startsWith("zh") ? "压缩对话上下文" : "Compacting context",
        startedAt: startedAt.toISOString(),
      },
      `model:${plan.context.stepId}:activity:started`,
      startedAt
    ),
    observer.signal
  );
  try {
    const provider = createAlibaba({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      includeUsage: true,
    });
    observer.heartbeat({
      stepId: plan.context.stepId,
      phase: "context_compaction",
      sourceMessageCount: plan.compaction.sourceMessageIds.length,
    });
    const result = await generateText({
      model: provider(plan.modelId),
      system: plan.system,
      messages: toModelMessages(plan.messages),
      maxRetries: 0,
      maxOutputTokens: plan.maxOutputTokens,
      timeout: plan.timeoutMs,
      abortSignal: observer.signal,
      toolChoice: "none",
    });
    const summaryText = result.text.trim();
    if (summaryText.length === 0) {
      throw new Error("Context compaction returned an empty checkpoint.");
    }
    const completedAt = observer.now();
    await gateway.completeContextCompaction({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      workflow,
      attemptId: plan.compaction.attemptId,
      sourceHash: plan.compaction.sourceHash,
      summaryText,
      providerResponseId: result.response.id,
      usage: {
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
        cachedInputTokens: result.totalUsage.inputTokenDetails.cacheReadTokens ?? null,
        reasoningTokens: result.totalUsage.outputTokenDetails.reasoningTokens ?? null,
      },
      completedAt: completedAt.toISOString(),
    });
  } catch (error) {
    const completedAt = observer.now();
    const cancelled = observer.signal.aborted;
    await gateway.failContextCompaction(
      cancelled
        ? {
            schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
            workflow,
            attemptId: plan.compaction.attemptId,
            status: "cancelled",
            completedAt: completedAt.toISOString(),
          }
        : {
            schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
            workflow,
            attemptId: plan.compaction.attemptId,
            status: "failed",
            error: toStudioAgentError(error, false),
            completedAt: completedAt.toISOString(),
          }
    );
    throw error;
  }
}

export function createToolBindings(
  capabilities: readonly StudioAgentPlannedCapability[]
): ToolBinding[] {
  const bindings = capabilities.map((planned) => ({
    providerName: providerToolName(planned.manifest.capabilityId),
    capability: planned.manifest,
    permission: planned.permission,
  }));
  const names = new Set<string>();
  for (const binding of bindings) {
    if (names.has(binding.providerName)) {
      throw new Error(`Provider tool alias collision for ${binding.capability.capabilityId}.`);
    }
    names.add(binding.providerName);
  }
  return bindings;
}

/**
 * What the workflow must do next.
 *
 * `wait_for_approval` wins over everything else the step produced. An
 * approval-gated call did not run — the SDK gated it — so the run has to
 * suspend on the channel and park until the creator answers, even if the same
 * step also queued work that could proceed. Letting a sibling action land while
 * the turn is visibly paused would change the workspace under a run the panel
 * is showing as waiting.
 */
function stepDirective(
  preparedActions: readonly StudioAgentPreparedAction[],
  childRuns: readonly StudioAgentChildRunPreparation[]
): StudioAgentModelStepOutcome["directive"] {
  if (preparedActions.some((prepared) => prepared.permissionDecision === "ask")) {
    return "wait_for_approval";
  }
  return preparedActions.length > 0 || childRuns.length > 0 ? "continue" : "complete";
}

export function toModelMessages(messages: readonly StudioAgentModelMessageJson[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    switch (message.role) {
      case "system":
        return message;
      case "user":
        return {
          role: "user",
          content: toUserContent(message.content),
        };
      case "assistant":
        return {
          role: "assistant",
          content: toAssistantContent(message.content),
        };
      case "tool":
        return {
          role: "tool",
          content: toToolContent(message.content),
        };
    }
  });
}

function toUserContent(
  content: Extract<StudioAgentModelMessageJson, { role: "user" }>["content"]
): UserContent {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => {
    if (part.type === "text") {
      return part;
    }
    if (part.type === "image") {
      return {
        type: "image" as const,
        image: part.source.kind === "url" ? new URL(part.source.url) : part.source.data,
        ...(part.source.mediaType ? { mediaType: part.source.mediaType } : {}),
      };
    }
    const mediaType = requireMediaType(part.source.mediaType);
    return {
      type: "file" as const,
      data: part.source.kind === "url" ? new URL(part.source.url) : part.source.data,
      mediaType,
      ...(part.fileName ? { filename: part.fileName } : {}),
    };
  });
}

function toAssistantContent(
  content: Extract<StudioAgentModelMessageJson, { role: "assistant" }>["content"]
): AssistantContent {
  if (typeof content === "string") {
    return content;
  }
  return content.map((part) => {
    switch (part.type) {
      case "text":
        return part;
      case "file": {
        const mediaType = requireMediaType(part.source.mediaType);
        return {
          type: "file" as const,
          data: part.source.kind === "url" ? new URL(part.source.url) : part.source.data,
          mediaType,
          ...(part.fileName ? { filename: part.fileName } : {}),
        };
      }
      case "tool-call":
        return {
          ...part,
          toolName: providerToolName(part.toolName),
        };
      case "tool-result":
        return {
          ...part,
          toolName: providerToolName(part.toolName),
          output: normalizeToolResultOutput(part.output),
        };
    }
  });
}

function toToolContent(
  content: Extract<StudioAgentModelMessageJson, { role: "tool" }>["content"]
): ToolContent {
  return content.map((part) => ({
    ...part,
    toolName: providerToolName(part.toolName),
    output: normalizeToolResultOutput(part.output),
  }));
}

function normalizeToolResultOutput(
  output: Extract<
    Extract<StudioAgentModelMessageJson, { role: "tool" }>["content"][number],
    { type: "tool-result" }
  >["output"]
): ModelToolResultPart["output"] {
  if (output.type === "execution-denied") {
    return output.reason === null
      ? { type: "execution-denied" }
      : { type: "execution-denied", reason: output.reason };
  }
  return output;
}

/**
 * THE APPROVAL GATE, DECLARED WHERE THE TOOL IS OFFERED.
 *
 * `needsApproval` is the AI SDK's own switch: with it set, `streamText` parses
 * the call, emits a `tool-approval-request` chunk carrying a fresh approvalId
 * and STOPS — it never runs the tool, and it finishes the step with
 * `finishReason: 'tool-calls'`, which `vercelRunOutcome` reports as `suspend`.
 * The library's codec encodes that chunk onto the channel as a tool part in
 * `approval-requested` state, `useChat` renders it, and
 * `addToolApprovalResponse` answers it. That is the entire approval mechanism;
 * there is no second one.
 *
 * It has to be a property of the OFFER, which is why the permission verdict
 * travels on the plan (`StudioAgentPlannedCapability`). Deciding it after the
 * model has already called the tool — where `prepareAction` decides it — is too
 * late by construction: by then the SDK has either run the tool or not.
 */
export function createCapabilityTools(
  bindings: readonly ToolBinding[]
): Record<string, Tool<unknown, never>> {
  return Object.fromEntries(
    bindings.map((binding) => [
      binding.providerName,
      tool({
        title: binding.capability.name,
        description: `${binding.capability.description}\nCapability: ${binding.capability.capabilityId}`,
        inputSchema: jsonSchema<unknown>(
          binding.capability.inputSchema as Parameters<typeof jsonSchema>[0]
        ),
        strict: true,
        needsApproval: binding.permission.decision === "ask",
      }),
    ])
  );
}

function validatePlanAgainstRuntime(
  plan: StudioAgentModelExecutionPlan,
  config: RuntimeModelConfig
): void {
  if (plan.provider !== "alibaba") {
    throw new Error(`Unsupported model provider ${plan.provider}.`);
  }
  if (plan.modelId !== config.textModelId && plan.modelId !== config.visionModelId) {
    throw new Error(
      `Model plan requests ${plan.modelId}; this runtime permits ${config.textModelId} and ${config.visionModelId}.`
    );
  }
  if (plan.kind === "response" && plan.capabilities.length > 64) {
    throw new Error(
      `Model plan exposes ${plan.capabilities.length} capabilities; provider ceiling is 64.`
    );
  }
  if (plan.maxOutputTokens > config.maxOutputTokens) {
    throw new Error(
      `Model plan requests ${plan.maxOutputTokens} output tokens; runtime ceiling is ${config.maxOutputTokens}.`
    );
  }
  if (plan.timeoutMs > config.timeoutMs) {
    throw new Error(
      `Model plan timeout ${plan.timeoutMs}ms exceeds runtime ceiling ${config.timeoutMs}ms.`
    );
  }
}

function eventDraft(
  workflow: StudioAgentWorkflowInput,
  type: StudioAgentEventDraft["type"],
  payload: unknown,
  idempotencyKey: string,
  occurredAt: Date
): StudioAgentEventDraft {
  return StudioAgentEventDraftSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: workflow.threadId,
    runId: workflow.runId,
    rootRunId: workflow.rootRunId,
    parentRunId: workflow.parentRunId,
    type,
    payload,
    occurredAt: occurredAt.toISOString(),
    idempotencyKey,
  });
}

/**
 * Drive the model stream to its end and say how it ended.
 *
 * With a channel, `RunStep.pipe` is the consumer: it encodes each UIMessage
 * chunk onto the run's step, appending text deltas to one accumulating Ably
 * message so a late subscriber gets the text so far rather than an empty
 * buffer. `pipe` deliberately never throws — a stream failure comes back as
 * `{reason: 'error'}` and marks the step failed — so the caller reads the
 * outcome rather than catching.
 *
 * Without a channel (a delegated task run) the stream still has to be drained
 * or `result.text` / `result.toolCalls` never resolve. Errors are captured and
 * shaped into the same {@link StreamResult} the pipe would have produced, so
 * exactly one outcome vocabulary reaches the caller.
 */
async function consumeModelStream(
  result: {
    consumeStream(options?: { onError?: (error: unknown) => void }): PromiseLike<void>;
    finishReason: PromiseLike<FinishReason>;
  },
  uiStream: ReadableStream<StudioAgentUIChunk>,
  delivery: ModelStepDelivery | null
): Promise<VercelRunOutcome> {
  if (delivery) {
    return vercelRunOutcome(await delivery.pipe(uiStream), result.finishReason);
  }
  let streamError: unknown = null;
  await result.consumeStream({
    onError: (error) => {
      streamError = error;
    },
  });
  const pipeResult: StreamResult = streamError
    ? { reason: "error", error: normalizeUnknownError(streamError) }
    : { reason: "complete" };
  return vercelRunOutcome(pipeResult, result.finishReason);
}

async function publishActivity(
  delivery: ModelStepDelivery | null,
  part: StudioAgentActivityPart
): Promise<void> {
  if (!delivery) return;
  await delivery.send(activityChunk(part));
}

async function publishFailure(
  delivery: ModelStepDelivery | null,
  part: StudioAgentFailurePart
): Promise<void> {
  if (!delivery) return;
  await delivery.send(failureChunk(part));
}

async function appendFailureEvents(input: {
  gateway: StudioAgentRuntimeGateway;
  workflow: StudioAgentWorkflowInput;
  plan: StudioAgentResponseModelExecutionPlan;
  activityId: string;
  content: string;
  failedAt: Date;
  errorRecord: StudioAgentError;
  cancelled: boolean;
  providerResponseId: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number | null;
    reasoningTokens: number | null;
  };
  activityStarted: boolean;
  activityTerminal: boolean;
  segmentStarted: boolean;
  segmentTerminal: boolean;
}): Promise<void> {
  const {
    gateway,
    workflow,
    plan,
    activityId,
    content,
    failedAt,
    errorRecord,
    cancelled,
    providerResponseId,
    usage,
    activityStarted,
    activityTerminal,
    segmentStarted,
    segmentTerminal,
  } = input;
  const nonCancelledSignal = undefined;
  const reports: Promise<unknown>[] = [];
  if (segmentStarted && !segmentTerminal) {
    reports.push(
      gateway.appendEvent(
        eventDraft(
          workflow,
          "assistant.segment.completed",
          {
            messageId: plan.assistantMessageId,
            segmentId: plan.segmentId,
            content,
            finishReason: cancelled ? "cancelled" : "error",
            providerResponseId,
            usage,
            completedAt: failedAt.toISOString(),
          },
          `model:${plan.context.stepId}:segment:${plan.segmentId}:terminal`,
          failedAt
        ),
        nonCancelledSignal
      )
    );
  }
  if (activityStarted && !activityTerminal) {
    reports.push(
      gateway.appendEvent(
        eventDraft(
          workflow,
          cancelled ? "activity.cancelled" : "activity.failed",
          cancelled
            ? {
                activityId,
                cancelledAt: failedAt.toISOString(),
              }
            : {
                activityId,
                error: errorRecord,
                failedAt: failedAt.toISOString(),
              },
          `model:${plan.context.stepId}:activity:terminal`,
          failedAt
        ),
        nonCancelledSignal
      )
    );
  }
  await Promise.allSettled(reports);
}

export function toStudioAgentError(error: unknown, cancelled = false): StudioAgentError {
  const normalized = normalizeUnknownError(error);
  return {
    code: cancelled ? "runtime.cancelled" : "runtime.model_failed",
    message: normalized.message.slice(0, 8_000),
    retryable: !cancelled,
    details: null,
  };
}

function normalizeUnknownError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function requireMediaType(mediaType: string | null): string {
  if (!mediaType) {
    throw new Error("A file model message must include its media type.");
  }
  return mediaType;
}
