/**
 * The copilot's language model — Qwen (Alibaba Tongyi) via the official
 * `@ai-sdk/alibaba` provider, the same model family the rest of the platform
 * routes Alibaba calls through (apps/agent's `createAlibabaModel`).
 *
 * This is the ONE place the brain is constructed, so swapping the backing
 * model (or, later, slotting a Mastra agent behind the same endpoint for
 * memory/workflows) is a single-file change. The endpoint, transport, and
 * client stay untouched because everything rides the AI SDK UI protocol.
 *
 * Required env (fail loud — never silently fall back to another provider):
 *   ALIBABA_API_KEY      DashScope key
 *   ALIBABA_BASE_URL     optional OpenAI-compatible base override
 *   COPILOT_MODEL        optional model id override (default qwen3.6-plus)
 */
import { createAlibaba } from '@ai-sdk/alibaba';
import type { LanguageModel } from 'ai';

/** Team-standard Alibaba model id (matches apps/agent ALIBABA_DEFAULT_MODEL). */
const DEFAULT_COPILOT_MODEL = 'qwen3.6-plus';

export function copilotModelId(): string {
  return process.env.COPILOT_MODEL?.trim() || DEFAULT_COPILOT_MODEL;
}

export function createCopilotModel(): LanguageModel {
  const apiKey = process.env.ALIBABA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'ALIBABA_API_KEY is not set — the studio copilot requires it (Qwen via DashScope).',
    );
  }
  const baseURL = process.env.ALIBABA_BASE_URL?.trim();
  const provider = createAlibaba({ apiKey, ...(baseURL ? { baseURL } : {}) });
  return provider(copilotModelId()) as unknown as LanguageModel;
}
