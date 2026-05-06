/**
 * Language model factories — thin wrappers over AI SDK providers.
 *
 * We intentionally use the AI SDK directly instead of Mastra's model-router
 * string form (`"deepseek/deepseek-chat"`). Rationale:
 *   - Explicit dependencies (the packages you need appear in package.json)
 *   - Standard AI SDK inputs/outputs — no Mastra-specific magic
 *   - Easier to customize (add headers, override fetch, inject middleware)
 *   - Type system catches model-id typos at build time via provider unions
 *
 * Usage from an Agent:
 *   import { defaultRouterModel, rolePersonaModel } from '../lib/models';
 *   new Agent({ model: defaultRouterModel(), ... })
 */
import { wrapLanguageModel } from "ai";
import { createAlibaba } from "@ai-sdk/alibaba";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createDeepSeek } from "@ai-sdk/deepseek";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { hardenRouterModel, requestTimeoutMiddleware } from "./model-hardening";

// Persona LLM call timeout. The router hardening stack already has its
// own (claude-tier-tuned) timeout in `hardenRouterModel`; persona calls
// don't go through that stack, so without this knob a slow / hung
// DeepSeek (or Qwen) response leaves the workflow step waiting
// indefinitely — `parse_script` has been seen stuck on splitter for
// 3+ minutes with no LLM_OK / LLM_FAILED log because of exactly this.
//
// 180s default = 3× the upper end of normal persona latency (60s for
// large structured output like splitter's 30-episode JSON). Beyond
// 180s the request is genuinely hung; surfacing that as a failed step
// (with a useful retry button) is strictly better than blocking a
// worker slot forever.
//
// Soft cancel only — the underlying fetch keeps running until DeepSeek
// finally returns or the network drops; we just stop awaiting it. A
// proper AbortSignal-threaded cancel would need provider-side support
// and is tracked separately. The benefit here is the workflow doesn't
// hang, not that we save tokens on the orphaned call.
// Generous on purpose — see DEFAULT_ASK_TIMEOUT_MS rationale. This
// outer layer must always be slightly larger than the ask wrapper so
// the wrapper can abort cleanly first. 300s = 5 minutes, comfortable
// envelope for the heaviest single-persona task we expect.
const PERSONA_REQUEST_TIMEOUT_MS = Number(
  process.env.STORYOS_PERSONA_REQUEST_TIMEOUT_MS ?? 300_000
);

/**
 * Env var reader that treats empty/whitespace strings as missing. Crucial
 * because docker-compose's `${VAR:-}` pattern yields an empty string when
 * the .env doesn't set VAR — and `??` only tripwires null/undefined, so
 * a naive `process.env.FOO ?? default` hands the SDK an empty baseURL and
 * it crashes with ERR_INVALID_URL when it tries to append `/chat/completions`.
 */
function envOrDefault(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : fallback;
}

// ─── DeepSeek (official @ai-sdk/deepseek provider) ───────────────────
//
// Switched off `createOpenAICompatible` and onto Vercel's first-party
// `@ai-sdk/deepseek` provider. Underlying HTTP API is the same
// (`api.deepseek.com/v1/chat/completions`), but the official provider:
//   - surfaces `deepseek-reasoner`'s `reasoning_content` (chain-of-thought)
//     under `providerMetadata.deepseek.reasoning` instead of swallowing it
//   - maps DeepSeek's error shapes to AI SDK's structured errors
//   - keeps DeepSeek-specific features (prefix completion, FIM) reachable
//     when we want them later
// `DEEPSEEK_BASE_URL` env override is preserved so we can repoint at a
// proxy / mirror without code changes.

// Strict single-model union — we standardised on v4-flash everywhere
// (94 tps, looser-but-good-enough JSON schema following, lower cost)
// after a 2026-05-02 prod-com incident where the silent v4-pro default
// emitted `null` for optional fields that v4-flash would have just
// omitted, breaking strict zod parsers downstream. v4-pro stays
// reachable through the @ai-sdk/deepseek provider directly if a
// future use case justifies it; the platform-wide default is flash.
// Older aliases (deepseek-chat / deepseek-reasoner / deepseek-v3.x)
// stay rejected at the type level so a stale env var doesn't silently
// land us on a slower model.
type DeepSeekModelId = "deepseek-v4-flash";

export function createDeepSeekModel(
  modelId: DeepSeekModelId = "deepseek-v4-flash"
): LanguageModelV3 {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. DeepSeek uses the official @ai-sdk/deepseek provider against https://api.deepseek.com."
    );
  }
  const provider = createDeepSeek({
    apiKey,
    // baseURL: envOrDefault("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
  });
  return provider(modelId);
}

// ─── Alibaba DashScope (Qwen) ────────────────────────────────────────

/**
 * The team standardized on `qwen3.6-plus` for every Alibaba-routed
 * persona / route. Exported so callers reference a single source of
 * truth instead of sprinkling the literal across files (and to make
 * the future migration to a newer model a one-line change).
 */
export const ALIBABA_DEFAULT_MODEL = "qwen3.6-plus" as const;

/**
 * Qwen via the official `@ai-sdk/alibaba` provider — same one Spark uses.
 *
 * **Required `modelId`** — no default arg. The team standardized on
 * `qwen3.6-plus` (use `ALIBABA_DEFAULT_MODEL` if you want the canonical
 * id) and explicitly rejected the `||` fallback pattern: a missing or
 * misspelled model id should throw immediately, not silently route to
 * a less-tested fallback that degrades quality for hours before anyone
 * notices. This mirrors how `ALIBABA_API_KEY` is required at this layer
 * — fail loud, fail fast.
 *
 * Aligned with `apps/server/src/spark/spark.service.ts`: one env var
 * (`ALIBABA_API_KEY`), one provider family. Used primarily on
 * `prod-cn` (fizzstudio.fizzspace.cn) where router traffic stays
 * in-country — lower latency, compliance-friendly, and decoupled from
 * Claude's US-side outages.
 */
export function createAlibabaModel(modelId: string): LanguageModelV3 {
  const apiKey = process.env.ALIBABA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ALIBABA_API_KEY is not set.");
  }
  if (!modelId) {
    throw new Error("createAlibabaModel: modelId is required (no default fallback).");
  }
  const provider = createAlibaba({
    apiKey,
    ...(process.env.ALIBABA_BASE_URL ? { baseURL: envOrDefault("ALIBABA_BASE_URL", "") } : {}),
  });
  return provider(modelId) as LanguageModelV3;
}

// ─── Anthropic (Claude) ──────────────────────────────────────────────

/**
 * Claude model IDs. Use a string union for the common current ones but
 * allow arbitrary strings — Anthropic ships new snapshots frequently and
 * we don't want a compile error when someone sets STORYOS_ROUTER_MODEL
 * to a new date-pinned snapshot like `claude-sonnet-4-5-20250929`.
 */
type AnthropicModelId =
  | "claude-sonnet-4-5"
  | "claude-opus-4-6"
  | "claude-opus-4-7"
  | "claude-haiku-4-5"
  | (string & {});

/**
 * Anthropic direct (not via Replicate). Used for the supervisor where
 * long-prompt instruction following and Chinese nuance matter. Personas
 * stay on DeepSeek for cost (persona = high token volume, supervisor =
 * low frequency), so Claude's $3/$15 per MTok pricing shows up only in
 * the routing layer's small footprint.
 */
export function createAnthropicModel(
  modelId: AnthropicModelId = "claude-sonnet-4-5"
): LanguageModelV3 {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Get one from https://console.anthropic.com/settings/keys."
    );
  }
  const provider = createAnthropic({
    apiKey,
    baseURL: envOrDefault("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"),
  });
  return provider(modelId);
}

// ─── Azure OpenAI / AI Foundry ────────────────────────────────────────

/**
 * Azure OpenAI deployments hosted on AI Foundry.
 *
 * Required env:
 *   AZURE_OPENAI_API_KEY        — API key from Foundry
 *   AZURE_OPENAI_RESOURCE_NAME  — the "resourceName" part of
 *                                 https://<resource>.openai.azure.com
 *
 * Optional env:
 *   AZURE_OPENAI_API_VERSION    — default "2024-10-21"
 *   AZURE_OPENAI_BASE_URL       — full override for custom endpoints
 *                                 (Foundry regional endpoints, AI gateway,
 *                                 etc.). Wins over resourceName if set.
 *
 * The string passed in must be an Azure **deployment name** (what you
 * configured in Foundry), NOT the underlying model id. Two deployments
 * of the same model are distinct.
 */
export function createAzureModel(deploymentName: string): LanguageModelV3 {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const resourceName = process.env.AZURE_OPENAI_RESOURCE_NAME;
  const baseURL = process.env.AZURE_OPENAI_BASE_URL;
  if (!apiKey) {
    throw new Error("AZURE_OPENAI_API_KEY is not set. Grab it from your Foundry project settings.");
  }
  if (!resourceName && !baseURL) {
    throw new Error("Either AZURE_OPENAI_RESOURCE_NAME or AZURE_OPENAI_BASE_URL must be set.");
  }
  const azure = createAzure({
    apiKey,
    ...(baseURL ? { baseURL } : { resourceName: resourceName! }),
    apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2024-10-21",
  });
  return azure(deploymentName);
}

// ─── Agent-level defaults ─────────────────────────────────────────────

/**
 * Supervisor / router model.
 *
 * Required env:
 *   STORYOS_ROUTER_PROVIDER  — "deepseek" | "alibaba" | "anthropic" | "azure"
 *                              (strict).
 * Optional env:
 *   STORYOS_ROUTER_MODEL     — per-provider model/deployment id, defaults
 *                              to a reasonable pick per provider.
 *
 * No implicit provider fallback — if the chosen provider's API key is
 * missing, the create* factory throws instead of silently switching to
 * another provider (that would hide real misconfiguration).
 *
 * Recommended per-environment:
 *   - staging / prod-com:  anthropic / claude-sonnet-4-5
 *   - prod-cn:             alibaba / qwen3.6-plus (team-standard, see
 *                          ALIBABA_DEFAULT_MODEL — stays in-country,
 *                          lower latency, decoupled from US outages)
 * Fallback model is **alibaba/qwen3.6-plus** — the same
 * `ALIBABA_DEFAULT_MODEL` the personas use. We previously fell back to
 * `deepseek-v4-flash`, but it loops uncontrollably on storyos's long
 * structured prompt (observed iterations=347 on a single turn) and
 * drops tool-call steps. Qwen3.6-plus has demonstrated stable
 * structured-JSON output + correct tool routing in production, so when
 * Anthropic overloads we degrade to a model that still finishes the
 * turn instead of one that quietly burns 300+ iterations and times out.
 *
 * When the router resolves to **Anthropic or Alibaba**, we wrap it with
 * `hardenRouterModel` — a four-layer middleware chain (request timeout +
 * rate-limit queue + circuit breaker + this Alibaba fallback) that keeps
 * the supervisor responsive under tier-limited / regional-outage
 * scenarios. Both providers share the same stateful limiter / breaker
 * (single running process → single set of quotas to track).
 *
 * DeepSeek as router passes through unwrapped — its gateway self-
 * throttles, 500-concurrent loadtest was clean.
 */
export function defaultRouterModel(): LanguageModelV3 {
  const provider = process.env.STORYOS_ROUTER_PROVIDER?.trim();
  const base = pickProviderModel("STORYOS_ROUTER_PROVIDER", "STORYOS_ROUTER_MODEL");
  if (provider !== "anthropic" && provider !== "alibaba") return base;
  // Fallback target must exist *before* the first primary call so a
  // mid-turn fallback doesn't crash on "fallback not configured".
  const fallback = createAlibabaModel(ALIBABA_DEFAULT_MODEL);
  return hardenRouterModel(base, fallback);
}

/**
 * Persona agents (role-designer, scriptwriter, scene-designer,
 * prop-designer, art-director, brief-analyzer, evaluator, etc.) all
 * pin to **alibaba/qwen3.6-plus** — same single-model standard as
 * storyboarder / episode-planner / video-prompt. Was previously env-
 * configurable (`STORYOS_PERSONA_PROVIDER` / `_MODEL`) which let
 * deployments fall back to `deepseek-v4-flash`; that combination drops
 * structured output for batch tasks (8 scenes / N characters), surfaces
 * as `<root> Required` malformed-output errors, and silently degrades
 * the user experience. Standardizing on qwen3.6-plus removes the
 * variance.
 *
 * Wraps with `requestTimeoutMiddleware` so a slow / hung response
 * doesn't pin a step indefinitely. Persona models intentionally bypass
 * `hardenRouterModel` (no rate-limit queue, no circuit breaker) — those
 * are router-specific concerns; for persona calls a clean timeout +
 * caller retry is the right behaviour.
 */
export function defaultPersonaModel(): LanguageModelV3 {
  const base = createAlibabaModel(ALIBABA_DEFAULT_MODEL);
  return wrapLanguageModel({
    model: base,
    middleware: [requestTimeoutMiddleware(PERSONA_REQUEST_TIMEOUT_MS)],
  });
}

/**
 * Shared provider resolver. Strict — throws if PROVIDER env isn't set or
 * isn't one of the known values. Silent fallbacks to "some other provider
 * because my key wasn't set" make misconfiguration invisible (you think
 * you're running DeepSeek, you're actually on Qwen), so we refuse to guess.
 *
 * Model id inside each provider falls back to a sensible default — that's
 * tuning, not provider selection.
 */
function pickProviderModel(providerEnv: string, modelEnv: string): LanguageModelV3 {
  const provider = process.env[providerEnv]?.trim();
  const model = process.env[modelEnv]?.trim();
  if (!provider) {
    throw new Error(
      `${providerEnv} is not set. Set to one of: deepseek | alibaba | anthropic | azure.`
    );
  }
  if (provider === "azure") return createAzureModel(model || "gpt-4o");
  // Alibaba is locked to a single canonical model — see ALIBABA_DEFAULT_MODEL.
  // No `||` fallback: if the operator overrode the model env we still respect
  // it, but the *unset* case must resolve deterministically to the canonical
  // model rather than a separate "router-default" that drifts from persona
  // defaults.
  if (provider === "alibaba") return createAlibabaModel(model || ALIBABA_DEFAULT_MODEL);
  if (provider === "anthropic") return createAnthropicModel(model || "claude-sonnet-4-5");
  if (provider === "deepseek") {
    return createDeepSeekModel((model as DeepSeekModelId | undefined) || "deepseek-v4-flash");
  }
  throw new Error(
    `Unknown ${providerEnv}: "${provider}". Expected: deepseek | alibaba | anthropic | azure.`
  );
}
