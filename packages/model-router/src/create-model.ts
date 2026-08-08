import { ChatOpenAI } from "@langchain/openai";

import { readLiteLlmConfigFromEnv, type LiteLlmConfig } from "./config.js";
import { resolveProfile, type ModelProfileId } from "./profiles.js";

export function createLiteLlmChatModel(input: {
  profileId: ModelProfileId | string;
  config?: LiteLlmConfig;
}): ChatOpenAI {
  const profile = resolveProfile(input.profileId);
  const config = input.config ?? readLiteLlmConfigFromEnv();
  // Profile table is authoritative. Do not silently remap to AGENT_OS_DEFAULT_MODEL.
  const model = profile.litellmModel;

  return new ChatOpenAI({
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
