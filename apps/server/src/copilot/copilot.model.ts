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
 *   COPILOT_MODEL        optional model id override (default qwen-plus)
 */
import { createAlibaba } from '@ai-sdk/alibaba';
import type { LanguageModel } from 'ai';
import { alibabaProviderHeaders } from '../common/alibaba-data-inspection';

// Use the model exposed by both regional provider catalogues. The controller
// disables thinking explicitly so tool calls fit its streaming timeouts.
const DEFAULT_COPILOT_MODEL = 'qwen-plus';

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
  const provider = createAlibaba({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    headers: alibabaProviderHeaders(),
  });
  return provider(copilotModelId()) as unknown as LanguageModel;
}
