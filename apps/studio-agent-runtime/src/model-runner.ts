import { createHash } from "node:crypto";
import { createAlibaba } from "@ai-sdk/alibaba";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentEventDraftSchema,
  StudioAgentJsonObjectSchema,
  StudioAgentModelStepOutcomeSchema,
  type StudioAgentAssistantSegmentOutput,
  type StudioAgentCapabilityManifest,
  type StudioAgentChildRunDescriptor,
  type StudioAgentContextCompactionModelExecutionPlan,
  type StudioAgentError,
  type StudioAgentEventDraft,
  type StudioAgentJsonObject,
  type StudioAgentModelExecutionPlan,
  type StudioAgentModelMessageJson,
  type StudioAgentModelStepOutcome,
  type StudioAgentPreparedAction,
  type StudioAgentPrepareActionRequest,
  type StudioAgentResponseModelExecutionPlan,
  type StudioAgentWorkflowInput,
} from "@repo/shared/studio-agent";
import {
  generateText,
  jsonSchema,
  streamText,
  tool,
  type AssistantContent,
  type ModelMessage,
  type Tool,
  type ToolContent,
  type UserContent,
} from "ai";
import type { RuntimeModelConfig } from "./config.js";
import type { StudioAgentRuntimeGateway } from "./gateway-client.js";

interface ModelRunObserver {
  signal: AbortSignal;
  heartbeat(details: unknown): void;
  now(): Date;
}

export interface ModelRunnerDependencies {
  gateway: StudioAgentRuntimeGateway;
  config: RuntimeModelConfig;
  observer: ModelRunObserver;
}

interface ToolBinding {
  providerName: string;
  capability: StudioAgentCapabilityManifest;
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
  const { gateway, config, observer } = dependencies;

  const activityId = plan.context.stepId;
  const startedAt = observer.now();
  const bindings = createToolBindings(plan.capabilities);
  const tools = createTools(bindings);
  const provider = createAlibaba({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    includeUsage: true,
  });

  let content = "";
  let pendingDelta = "";
  let lastFlushAt = observer.now().getTime();
  let deltaOrdinal = 0;
  let providerResponseId: string | null = null;
  let finishReason: "stop" | "length" = "stop";
  let activityStarted = false;
  let activityTerminal = false;
  let segmentStarted = false;
  let segmentTerminal = false;
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: null as number | null,
    reasoningTokens: null as number | null,
  };
  const toolCalls: Array<{
    toolCallId: string;
    providerName: string;
    input: StudioAgentJsonObject;
  }> = [];

  const flushDelta = async (force: boolean): Promise<void> => {
    if (pendingDelta.length === 0) {
      return;
    }
    const now = observer.now().getTime();
    if (
      !force &&
      Buffer.byteLength(pendingDelta, "utf8") < config.deltaBytes &&
      now - lastFlushAt < config.deltaIntervalMs
    ) {
      return;
    }
    const delta = pendingDelta;
    pendingDelta = "";
    lastFlushAt = now;
    await gateway.appendEvent(
      eventDraft(
        workflow,
        "assistant.segment.delta",
        {
          messageId: plan.assistantMessageId,
          segmentId: plan.segmentId,
          delta,
        },
        `model:${plan.context.stepId}:segment:${plan.segmentId}:delta:${deltaOrdinal}`,
        observer.now()
      ),
      observer.signal
    );
    deltaOrdinal += 1;
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
          label: "studio_agent.activity.generating_response",
          startedAt: startedAt.toISOString(),
        },
        `model:${plan.context.stepId}:activity:started`,
        startedAt
      ),
      observer.signal
    );
    activityStarted = true;
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

    for await (const part of result.fullStream) {
      observer.heartbeat({
        stepId: plan.context.stepId,
        streamPart: part.type,
        textBytes: Buffer.byteLength(content, "utf8"),
        toolCallCount: toolCalls.length,
      });
      switch (part.type) {
        case "text-delta":
          content += part.text;
          pendingDelta += part.text;
          await flushDelta(false);
          break;
        case "tool-call":
          if (part.invalid) {
            throw new Error(`Model emitted an invalid tool call for ${part.toolName}.`, {
              cause: part.error,
            });
          }
          toolCalls.push({
            toolCallId: part.toolCallId,
            providerName: part.toolName,
            input: StudioAgentJsonObjectSchema.parse(part.input),
          });
          break;
        case "finish-step":
          providerResponseId = part.response.id;
          break;
        case "finish":
          usage = {
            inputTokens: part.totalUsage.inputTokens ?? 0,
            outputTokens: part.totalUsage.outputTokens ?? 0,
            cachedInputTokens: part.totalUsage.inputTokenDetails.cacheReadTokens ?? null,
            reasoningTokens: part.totalUsage.outputTokenDetails.reasoningTokens ?? null,
          };
          // Only a hard output-token truncation changes the disposition; every
          // other clean end (plain stop, or a stop that emitted tool calls) is
          // a normal completion. Provider errors/aborts surface via the error
          // and abort stream parts, which throw before reaching this event.
          if (part.finishReason === "length") {
            finishReason = "length";
          }
          break;
        case "error":
          throw normalizeUnknownError(part.error);
        case "abort":
          throw new Error(part.reason ?? "The model stream was aborted.");
        default:
          break;
      }
    }

    await flushDelta(true);
    const preparedActions: StudioAgentPreparedAction[] = [];
    const childRuns: StudioAgentChildRunDescriptor[] = [];
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
      directive: preparedActions.length > 0 || childRuns.length > 0 ? "continue" : "complete",
      usage,
      completedAt: completedAt.toISOString(),
    });
  } catch (error) {
    const failedAt = observer.now();
    const cancelled = observer.signal.aborted;
    await appendFailureEvents({
      gateway,
      workflow,
      plan,
      activityId,
      content,
      failedAt,
      cancelled,
      error,
      providerResponseId,
      usage,
      activityStarted,
      activityTerminal,
      segmentStarted,
      segmentTerminal,
    });
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
  capabilities: readonly StudioAgentCapabilityManifest[]
): ToolBinding[] {
  const bindings = capabilities.map((capability) => ({
    providerName: providerToolName(capability.capabilityId),
    capability,
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

function createTools(bindings: readonly ToolBinding[]): Record<string, Tool<unknown, never>> {
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
      }),
    ])
  );
}

function providerToolName(capabilityId: string): string {
  const readable = capabilityId.replace(/[^a-z0-9_]/g, "_").slice(0, 47);
  const digest = createHash("sha256").update(capabilityId).digest("hex").slice(0, 12);
  return `cap_${readable}_${digest}`;
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

async function appendFailureEvents(input: {
  gateway: StudioAgentRuntimeGateway;
  workflow: StudioAgentWorkflowInput;
  plan: StudioAgentResponseModelExecutionPlan;
  activityId: string;
  content: string;
  failedAt: Date;
  cancelled: boolean;
  error: unknown;
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
    cancelled,
    error,
    providerResponseId,
    usage,
    activityStarted,
    activityTerminal,
    segmentStarted,
    segmentTerminal,
  } = input;
  const errorRecord = toStudioAgentError(error, cancelled);
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
