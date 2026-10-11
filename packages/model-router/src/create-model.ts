import { ChatOpenAICompletions } from "@langchain/openai";
import type { ChatGenerationChunk } from "@langchain/core/outputs";

import { readLiteLlmConfigFromEnv, type LiteLlmConfig } from "./config.js";
import { resolveProfile, type ModelProfileId } from "./profiles.js";

export class IncompleteModelStreamError extends Error {
  constructor() {
    super("The model connection ended before its response was complete.");
    this.name = "IncompleteModelStreamError";
  }
}

export class InvalidToolResponseError extends Error {
  readonly code = "MODEL_TOOL_CALL_INVALID";

  constructor() {
    super(
      "The model returned an invalid tool response. No action was taken for this response. Please try again."
    );
    this.name = "InvalidToolResponseError";
  }
}

/** Reject protocol failures; ordinary discussion and mentions of tools remain valid. */
function assertValidToolResponse(
  response: {
    content: unknown;
    tool_calls?: readonly { name?: string }[];
    invalid_tool_calls?: readonly unknown[];
    additional_kwargs?: { tool_calls?: unknown };
  },
  toolNames: readonly string[]
): void {
  // LangChain repairs partial JSON while aggregating argument deltas. Only
  // fully valid provider JSON is executable once the response has finished.
  const rawCalls = response.additional_kwargs?.tool_calls;
  if (rawCalls !== undefined) {
    if (!Array.isArray(rawCalls)) throw new InvalidToolResponseError();
    for (const call of rawCalls) {
      try {
        const argumentsValue: unknown = JSON.parse(call.function.arguments);
        if (
          !argumentsValue ||
          typeof argumentsValue !== "object" ||
          Array.isArray(argumentsValue)
        ) {
          throw new InvalidToolResponseError();
        }
      } catch {
        throw new InvalidToolResponseError();
      }
    }
  }
  if (
    response.invalid_tool_calls?.length ||
    response.tool_calls?.some((call) => !call.name || !toolNames.includes(call.name))
  )
    throw new InvalidToolResponseError();
  if (
    !response.tool_calls?.length &&
    typeof response.content === "string" &&
    toolNames.length > 0 &&
    (!response.content.trim() || toolNames.includes(response.content.trim()))
  )
    throw new InvalidToolResponseError();
}

/** An SSE connection closing is not a completed model response. */
class LiteLlmChatModel extends ChatOpenAICompletions {
  override async *_streamResponseChunks(
    ...args: Parameters<ChatOpenAICompletions["_streamResponseChunks"]>
  ) {
    // Forward callbacks only after validation too: LangGraph consumes token
    // callbacks as well as iterator chunks when projecting its event stream.
    for await (const chunk of this.validatedResponseChunks(args[0], args[1])) {
      yield chunk;
      await args[2]?.handleLLMNewToken(
        chunk.text,
        {
          prompt: args[1].promptIndex ?? 0,
          completion: Number(chunk.generationInfo?.completion ?? 0),
        },
        undefined,
        undefined,
        undefined,
        { chunk }
      );
    }
  }

  private async *validatedResponseChunks(
    messages: Parameters<ChatOpenAICompletions["_streamResponseChunks"]>[0],
    options: Parameters<ChatOpenAICompletions["_streamResponseChunks"]>[1]
  ) {
    let finishReason: string | undefined;
    const names = (options.tools ?? []).flatMap((tool) =>
      "function" in tool && typeof tool.function?.name === "string" ? [tool.function.name] : []
    );
    let response: ChatGenerationChunk | undefined;
    let holdToolPrefix = names.length > 0;
    const buffered: ChatGenerationChunk[] = [];
    for await (const chunk of super._streamResponseChunks(messages, options)) {
      response = response ? response.concat(chunk) : chunk;
      if (typeof chunk.generationInfo?.finish_reason === "string") {
        finishReason = chunk.generationInfo.finish_reason;
      }
      if (holdToolPrefix) {
        buffered.push(chunk);
        const text = response.text.trim();
        if (names.some((name) => name.startsWith(text))) continue;
        holdToolPrefix = false;
        yield* buffered;
        buffered.length = 0;
      } else yield chunk;
    }
    options.signal?.throwIfAborted();
    if (!finishReason) throw new IncompleteModelStreamError();
    if (finishReason === "length") {
      throw new Error("The model response exceeded its output limit before completion.");
    }
    if (finishReason === "content_filter") {
      throw new Error("The model provider stopped the response because of its content policy.");
    }
    if (
      finishReason === "tool_calls" &&
      !(response?.message as { tool_calls?: unknown[] } | undefined)?.tool_calls?.length
    ) {
      throw new InvalidToolResponseError();
    }
    if (response) assertValidToolResponse(response.message, names);
    yield* buffered;
  }
}

export function createLiteLlmChatModel(input: {
  profileId: ModelProfileId | string;
  config?: LiteLlmConfig;
}): ChatOpenAICompletions {
  const profile = resolveProfile(input.profileId);
  const config = input.config ?? readLiteLlmConfigFromEnv();
  // Profile table is authoritative. Do not silently remap to AGENT_OS_DEFAULT_MODEL.
  const model = profile.model;

  return new LiteLlmChatModel({
    model,
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    apiKey: config.apiKey,
    /** Token stream for Agent OS MessageDelta / UI progressive render. */
    streaming: true,
    configuration: {
      baseURL: config.baseUrl,
    },
    modelKwargs: {
      ...(profile.enableThinking !== undefined ? { enable_thinking: profile.enableThinking } : {}),
      /**
       * One tool call per assistant turn.
       *
       * A sensitive write pauses the graph for human approval, and the whole
       * approval path — the protocol's single `pendingApproval`, the one card
       * the UI renders, the resume that answers it — assumes at most one is
       * pending. Two writes proposed in the same message break that: resuming
       * re-runs the tools node, so the approved write executes twice while the
       * second fails on a stale revision.
       *
       * Sequential is also the better product behaviour for writes: the user
       * judges one change at a time, and the model sees the result of the
       * first before proposing the second.
       */
      parallel_tool_calls: false,
    },
  });
}
