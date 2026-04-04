import { gateway } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";

const defaultModelId = process.env.AI_GATEWAY_MODEL || "anthropic/claude-sonnet-4";

export function getModel(modelId?: string): LanguageModelV3 {
  return gateway.languageModel(modelId || defaultModelId);
}
