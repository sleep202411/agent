import { ChatOpenAICompletions } from "@langchain/openai";

import { readLiteLlmConfigFromEnv, type LiteLlmConfig } from "./config.js";
import { resolveProfile, type ModelProfileId } from "./profiles.js";

export class IncompleteModelStreamError extends Error {
  constructor() {
    super("The model connection ended before its response was complete.");
    this.name = "IncompleteModelStreamError";
  }
}

/** An SSE connection closing is not a completed model response. */
class LiteLlmChatModel extends ChatOpenAICompletions {
  override async *_streamResponseChunks(
    ...args: Parameters<ChatOpenAICompletions["_streamResponseChunks"]>
  ) {
    let finishReason: string | undefined;
    for await (const chunk of super._streamResponseChunks(...args)) {
      if (typeof chunk.generationInfo?.finish_reason === "string") {
        finishReason = chunk.generationInfo.finish_reason;
      }
      yield chunk;
    }
    args[1].signal?.throwIfAborted();
    if (!finishReason) throw new IncompleteModelStreamError();
    if (finishReason === "length") {
      throw new Error("The model response exceeded its output limit before completion.");
    }
    if (finishReason === "content_filter") {
      throw new Error("The model provider stopped the response because of its content policy.");
    }
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
