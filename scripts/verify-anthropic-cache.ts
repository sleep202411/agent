#!/usr/bin/env tsx
/**
 * Verifies that Anthropic prompt caching actually fires by making two
 * back-to-back requests with the same (large) system prompt and the
 * `cache_control: ephemeral` marker. A successful cache hit on the second
 * call reports `usage.cache_read_input_tokens > 0` in the response.
 *
 * Requires funded ANTHROPIC_API_KEY. Cost: ~$0.02 (first call writes the
 * cache at 1.25× input price, second call reads at 10× discount).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... tsx scripts/verify-anthropic-cache.ts
 */

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY not set");
  process.exit(1);
}

const MODEL = process.env.STORYOS_ROUTER_MODEL || "claude-sonnet-4-5";

// Pad the system prompt to at least 1024 tokens — Anthropic won't cache
// prompts below that minimum regardless of the cache_control marker.
const SYSTEM_PROMPT = (() => {
  const lead =
    "You are a test assistant. Reply with exactly one word: the capital of the country mentioned in the user's message.";
  const filler =
    "\n\nAdditional context block (intentionally verbose to clear the 1024-token minimum for caching):\n" +
    Array.from(
      { length: 120 },
      (_, i) => `- Rule #${i + 1}: Ignore this line; it only exists to pad the prompt.`
    ).join("\n");
  return lead + filler;
})();

async function oneCall(userMessage: string) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 32,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status}: ${body.slice(0, 300)}`);
  }
  return (await resp.json()) as {
    content: Array<{ text?: string }>;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

async function main() {
  console.log(`Model: ${MODEL}`);
  console.log(
    `System prompt: ${SYSTEM_PROMPT.length} chars (~${Math.round(SYSTEM_PROMPT.length / 4)} tokens)\n`
  );

  console.log("→ Call #1 (expected to WRITE cache)…");
  const t1 = Date.now();
  const r1 = await oneCall("France");
  const ms1 = Date.now() - t1;
  console.log(`   reply: "${r1.content[0]?.text?.trim()}"  latency: ${ms1}ms`);
  console.log(`   usage: input=${r1.usage.input_tokens} output=${r1.usage.output_tokens}`);
  console.log(`          cache_creation=${r1.usage.cache_creation_input_tokens ?? 0}`);
  console.log(`          cache_read=${r1.usage.cache_read_input_tokens ?? 0}`);

  console.log("\n→ Call #2 (expected to READ cache)…");
  const t2 = Date.now();
  const r2 = await oneCall("Japan");
  const ms2 = Date.now() - t2;
  console.log(`   reply: "${r2.content[0]?.text?.trim()}"  latency: ${ms2}ms`);
  console.log(`   usage: input=${r2.usage.input_tokens} output=${r2.usage.output_tokens}`);
  console.log(`          cache_creation=${r2.usage.cache_creation_input_tokens ?? 0}`);
  console.log(`          cache_read=${r2.usage.cache_read_input_tokens ?? 0}`);

  const cacheHit = (r2.usage.cache_read_input_tokens ?? 0) > 0;
  console.log(
    `\n${cacheHit ? "✅ CACHE HIT on call #2" : "❌ NO cache hit — check min-token threshold / API version / account tier"}`
  );
  if (cacheHit) {
    const saved = r2.usage.cache_read_input_tokens!;
    console.log(`   Reused ${saved} tokens at 10% price. TPM impact: essentially zero.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
