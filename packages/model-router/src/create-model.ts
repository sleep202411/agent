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
  });
}
