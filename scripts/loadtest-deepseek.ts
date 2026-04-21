#!/usr/bin/env tsx
/**
 * DeepSeek concurrency load test — probes how many simultaneous in-flight
 * chat-completion requests the account can sustain without rate-limit / 5xx
 * errors.
 *
 * Cost: ~50 input + ~50 output tokens per call. At $0.27/$1.10 per MTok
 * (deepseek-chat V3), 500 calls ≈ $0.01. One full sweep (10/50/100/250/500)
 * ≈ $0.05.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=sk-... tsx scripts/loadtest-deepseek.ts [concurrency...]
 *
 * Default sweeps: 10 50 100 250 500. Override by passing specific levels:
 *   tsx scripts/loadtest-deepseek.ts 50 100 200
 *
 * Each level fires `concurrency` requests in parallel (Promise.all), waits
 * for all to settle, and reports a single-row summary. No pacing — tests
 * the worst-case burst scenario (500 users clicking "开始创作" at once).
 */

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  console.error("DEEPSEEK_API_KEY not set");
  process.exit(1);
}

const BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

interface Result {
  ok: boolean;
  status: number;
  ms: number;
  error?: string;
}

async function oneRequest(id: number): Promise<Result> {
  const start = Date.now();
  try {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            // Tiny, deterministic, caches well.
            content: `Reply with just the number ${id}.`,
          },
        ],
        max_tokens: 8,
        temperature: 0,
      }),
    });
    const ms = Date.now() - start;
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return {
        ok: false,
        status: resp.status,
        ms,
        error: body.slice(0, 120),
      };
    }
    // Drain body so connection releases
    await resp.json();
    return { ok: true, status: resp.status, ms };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

async function runLevel(concurrency: number): Promise<void> {
  const start = Date.now();
  const results = await Promise.all(Array.from({ length: concurrency }, (_, i) => oneRequest(i)));
  const wall = Date.now() - start;

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const successLatencies = ok.map((r) => r.ms).sort((a, b) => a - b);
  const errorGroups = new Map<string, number>();
  for (const r of failed) {
    const key = r.status > 0 ? `HTTP ${r.status}` : "network/timeout";
    errorGroups.set(key, (errorGroups.get(key) ?? 0) + 1);
  }

  const successRate = ((ok.length / concurrency) * 100).toFixed(1);
  const p50 = percentile(successLatencies, 0.5);
  const p95 = percentile(successLatencies, 0.95);
  const p99 = percentile(successLatencies, 0.99);
  const max = successLatencies[successLatencies.length - 1] ?? 0;

  console.log(
    `\n── concurrency=${concurrency}  wall=${wall}ms  success=${ok.length}/${concurrency} (${successRate}%)`
  );
  if (ok.length > 0) {
    console.log(`   latency  p50=${p50}ms  p95=${p95}ms  p99=${p99}ms  max=${max}ms`);
  }
  if (failed.length > 0) {
    console.log(`   errors:`);
    for (const [key, count] of errorGroups) {
      const sampleErr = failed.find((r) => {
        const k = r.status > 0 ? `HTTP ${r.status}` : "network/timeout";
        return k === key;
      });
      console.log(`     ${key}: ${count}${sampleErr?.error ? `   "${sampleErr.error}"` : ""}`);
    }
  }
}

async function main() {
  const levels =
    process.argv.slice(2).length > 0
      ? process.argv
          .slice(2)
          .map((n) => Number(n))
          .filter((n) => n > 0)
      : [10, 50, 100, 250, 500];

  console.log(`DeepSeek load test @ ${BASE_URL} model=${MODEL}`);
  console.log(`Levels: ${levels.join(" ")}`);

  for (const level of levels) {
    await runLevel(level);
    // Cool-down between levels so any rate-limit window resets.
    if (levels.indexOf(level) < levels.length - 1) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
