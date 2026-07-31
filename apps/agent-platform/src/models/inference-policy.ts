import type { MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";
import type { UIMessage } from "ai";
import { z } from "zod";

import type { FizzDragonRequestContext } from "../context/agent-context.js";

export const INFERENCE_TIER_KEY = "inferenceTier" as const;
export const inferenceTierSchema = z.enum(["interactive", "reasoning"]);
export type InferenceTier = z.infer<typeof inferenceTierSchema>;

/**
 * Hard cap on interactive-tier thinking tokens.
 *
 * Gemini 2.5 spends its entire thinking allowance before emitting the first
 * output token, so with dynamic (unbounded) thinking the wait is invisible to
 * streaming and lands wholly on TTFT. Measured from this codebase against
 * Vertex (gemini-2.5-flash, project glass-proxy-501907-d2): thinking costs
 * ~6-8ms per thought token, a 243-thought-token greeting paid +1.5s before its
 * first chunk, and production conversational turns burned 243-378 reasoning
 * tokens — ~3.1-3.5s of the 4.2s average time-to-first-output.
 *
 * 256 rather than 0: story tools are chosen by the model, and zero would
 * disable reasoning outright for every tool-selection decision. 256 covers the
 * observed greeting-class spend (243), is double gemini-2.5-pro's enforced
 * minimum (128, the budget the long-document map stage already ships with),
 * and bounds the worst-case pre-token delay at ~1.5-2s instead of an unbounded
 * dynamic tail. The reasoning tier deliberately keeps dynamic thinking.
 */
export const INTERACTIVE_THINKING_BUDGET_TOKENS = 256;

export type InferenceThinkingProviderOptions = Readonly<{
  google: Readonly<{ thinkingConfig: Readonly<{ thinkingBudget: number }> }>;
}>;

/**
 * Per-call provider options for one model step. This travels on the explicit
 * agent.stream call options — the same per-call placement contract as the
 * readOnly memory flag; constructor- or Memory-level configuration is not
 * consulted by the runtime. The `google` key is resolved by the Vertex
 * provider as its documented fallback, matching the long-document precedent.
 */
export function inferenceThinkingProviderOptions(
  tier: InferenceTier
): InferenceThinkingProviderOptions | undefined {
  if (tier !== "interactive") return undefined;
  return {
    google: { thinkingConfig: { thinkingBudget: INTERACTIVE_THINKING_BUDGET_TOKENS } },
  };
}

const REASONING_TEXT_THRESHOLD = 1_200;
const DEEP_INTENT =
  /(?:全面|深入|系统(?:性|地)?|详细|完整).{0,16}(?:分析|规划|评估|审查|拆解|改编|重构)|(?:分析|拆解|改编).{0,16}(?:整部|全文|长篇|剧本)|\b(?:comprehensive|deep|thorough|long[- ]form|whole (?:script|story)|architecture review)\b/iu;

/**
 * Selects the model class without adding a classifier-model round trip.
 *
 * The interactive model owns conversational turns and focused product
 * actions. Source material, long prompts and explicitly deep analysis use the
 * reasoning model. The decision is computed from the canonical run, so tool
 * continuation steps retain the same tier as their originating user input.
 */
export function classifyInferenceTier(messages: ReadonlyArray<UIMessage>): InferenceTier {
  let text = "";
  for (const message of messages) {
    for (const part of message.parts) {
      if (containsAttachment(part)) return "reasoning";
      if (part.type === "text" && typeof part.text === "string") {
        text += `${part.text}\n`;
      }
    }
  }

  const normalized = text.trim();
  if (normalized.length >= REASONING_TEXT_THRESHOLD || DEEP_INTENT.test(normalized)) {
    return "reasoning";
  }
  return "interactive";
}

export function writeInferenceTier(
  requestContext: RequestContext<FizzDragonRequestContext>,
  tier: InferenceTier
): void {
  requestContext.set(INFERENCE_TIER_KEY, inferenceTierSchema.parse(tier));
}

export function createInferenceModelRouter(
  models: Readonly<{
    interactive: MastraModelConfig;
    reasoning: MastraModelConfig;
  }>
): (input: { requestContext: RequestContext<FizzDragonRequestContext> }) => MastraModelConfig {
  return ({ requestContext }) => {
    const tier = inferenceTierSchema.parse(requestContext.get(INFERENCE_TIER_KEY));
    return tier === "reasoning" ? models.reasoning : models.interactive;
  };
}

function containsAttachment(part: UIMessage["parts"][number]): boolean {
  if (part.type === "file") return true;
  const record = part as unknown as Record<string, unknown>;
  return ["url", "uri", "data"].some((key) => {
    const value = record[key];
    return (
      typeof value === "string" &&
      (value.startsWith("fizzdragon-media://") || value.startsWith("data:application/"))
    );
  });
}
