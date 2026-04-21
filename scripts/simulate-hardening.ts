#!/usr/bin/env tsx
/**
 * simulate-hardening — runs the real `hardenAnthropicModel` wrapper against
 * scripted fake `LanguageModelV3` implementations to visualize the three
 * resilience layers under controlled pressure.
 *
 * Zero cost: no real LLM is called. Both primary and fallback are
 * in-process mocks whose behaviour (success / 429 / slow / sequence) is
 * scripted per scenario.
 *
 * Usage:
 *   tsx scripts/simulate-hardening.ts         # run all scenarios
 *   tsx scripts/simulate-hardening.ts 2 3     # run only scenarios 2 and 3
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider";
import {
  hardenAnthropicModel,
  _resetSharedStateForTests,
  type HardenConfig,
} from "../apps/agent/src/mastra/lib/model-hardening";

// ─── Fake model factory ────────────────────────────────────────────────

type Behavior =
  | { kind: "ok"; delayMs?: number }
  | { kind: "error"; statusCode: number; message: string; delayMs?: number };

interface FakeOptions {
  name: string;
  /**
   * Returns the behaviour for call N (0-indexed). Lets scenarios script
   * things like "first 5 calls throw 429, then succeed".
   */
  behaviorAt: (callIndex: number) => Behavior;
}

function makeFake({ name, behaviorAt }: FakeOptions): LanguageModelV3 {
  let callIndex = 0;
  const execute = async (
    _opts: LanguageModelV3CallOptions
  ): Promise<LanguageModelV3GenerateResult> => {
    const n = callIndex++;
    const b = behaviorAt(n);
    if (b.delayMs) await sleep(b.delayMs);
    if (b.kind === "error") {
      const err = new Error(b.message) as Error & {
        statusCode: number;
        status: number;
      };
      err.statusCode = b.statusCode;
      err.status = b.statusCode;
      throw err;
    }
    return {
      content: [{ type: "text", text: `[${name}] call #${n}` }],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      warnings: [],
    };
  };
  return {
    specificationVersion: "v3",
    provider: `fake-${name}`,
    modelId: `fake-${name}-model`,
    supportedUrls: {},
    doGenerate: execute,
    doStream: async () => {
      throw new Error("doStream not mocked in this simulation");
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Timeline logger ───────────────────────────────────────────────────

let t0 = 0;
function resetClock() {
  t0 = Date.now();
}
function ts(): string {
  const ms = Date.now() - t0;
  return `t=${String(ms).padStart(5, " ")}ms`;
}
function log(tag: string, msg: string) {
  console.log(`  ${ts()}  ${tag.padEnd(10)} ${msg}`);
}

// ─── Fire N parallel calls, collect outcomes ───────────────────────────

interface CallOutcome {
  callNo: number;
  ok: boolean;
  provider: string;
  usedFallback: boolean;
  latencyMs: number;
  error?: string;
}

async function fireParallel(model: LanguageModelV3, count: number): Promise<CallOutcome[]> {
  const tasks = Array.from({ length: count }, async (_, i): Promise<CallOutcome> => {
    const start = Date.now();
    try {
      const result = await model.doGenerate({
        prompt: [],
        maxOutputTokens: 8,
      } as unknown as LanguageModelV3CallOptions);
      const metadata = result.providerMetadata as
        | { storyos?: { usedFallback?: boolean } }
        | undefined;
      const usedFallback = metadata?.storyos?.usedFallback === true;
      return {
        callNo: i,
        ok: true,
        provider: result.content[0]?.type === "text" ? result.content[0].text : "",
        usedFallback,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        callNo: i,
        ok: false,
        provider: "",
        usedFallback: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.name + ": " + err.message : String(err),
      };
    }
  });
  return Promise.all(tasks);
}

function summarize(label: string, outcomes: CallOutcome[]): void {
  const ok = outcomes.filter((o) => o.ok);
  const failed = outcomes.filter((o) => !o.ok);
  const fromPrimary = ok.filter((o) => !o.usedFallback);
  const fromFallback = ok.filter((o) => o.usedFallback);
  const latencies = ok.map((o) => o.latencyMs).sort((a, b) => a - b);
  const mean = latencies.length
    ? Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length)
    : 0;
  const max = latencies[latencies.length - 1] ?? 0;
  console.log(`  SUMMARY ${label}:`);
  console.log(
    `    ok=${ok.length}/${outcomes.length}  primary=${fromPrimary.length}  fallback=${fromFallback.length}  failed=${failed.length}`
  );
  console.log(`    latency  mean=${mean}ms  max=${max}ms`);
  if (failed.length > 0) {
    const errGroups = new Map<string, number>();
    for (const f of failed)
      errGroups.set(f.error ?? "unknown", (errGroups.get(f.error ?? "unknown") ?? 0) + 1);
    for (const [err, n] of errGroups) console.log(`    ERR ${err}: ×${n}`);
  }
}

// ─── Scenarios ─────────────────────────────────────────────────────────

const RATE_LIMIT_ERR = (n: number): Behavior => ({
  kind: "error",
  statusCode: 429,
  message: `Rate limit hit on call #${n}`,
});

async function scenario1_pureQueueing(): Promise<void> {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 1: 纯排队（并发=20 / 槽位=5 / primary 500ms 正常返回）");
  console.log("期望：排队无损发生，全部走 primary，wall ≈ 2s（20/5 × 500ms）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  _resetSharedStateForTests();
  const primary = makeFake({
    name: "primary",
    behaviorAt: () => ({ kind: "ok", delayMs: 500 }),
  });
  const fallback = makeFake({
    name: "fallback",
    behaviorAt: () => ({ kind: "ok" }),
  });
  const config: HardenConfig = {
    maxConcurrency: 5,
    queueTimeoutMs: 30_000,
    queueMaxDepth: 100,
    circuitFailureThreshold: 999,
    circuitCooldownMs: 60_000,
  };
  const hardened = hardenAnthropicModel(primary, fallback, config);
  resetClock();
  log("FIRE", "20 parallel calls (primary delay=500ms)");
  const out = await fireParallel(hardened, 20);
  summarize("scenario 1", out);
}

async function scenario2_queueTimeoutFallback(): Promise<void> {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 2: 队列超时 → fallback");
  console.log("config: concurrency=5 queueTimeout=300ms; primary 每次 500ms 成功");
  console.log("期望：前 5 走 primary（~500ms），其余等不到 300ms 超时 → fallback");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  _resetSharedStateForTests();
  const primary = makeFake({
    name: "primary",
    behaviorAt: () => ({ kind: "ok", delayMs: 500 }),
  });
  const fallback = makeFake({
    name: "fallback",
    behaviorAt: () => ({ kind: "ok", delayMs: 50 }),
  });
  const config: HardenConfig = {
    maxConcurrency: 5,
    queueTimeoutMs: 300,
    queueMaxDepth: 100,
    circuitFailureThreshold: 999,
    circuitCooldownMs: 60_000,
  };
  const hardened = hardenAnthropicModel(primary, fallback, config);
  resetClock();
  log("FIRE", "20 parallel calls");
  const out = await fireParallel(hardened, 20);
  summarize("scenario 2", out);
}

async function scenario3_circuitTrip(): Promise<void> {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 3: 熔断触发（primary 连续 429）");
  console.log("config: threshold=5 cooldown=1s; primary 100% 返回 429");
  console.log(
    "期望：前 5 次失败 → 熔断 OPEN → 之后全部 fallback，其中前 5 标 rate_limit，后续标 circuit_open"
  );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  _resetSharedStateForTests();
  const primary = makeFake({
    name: "primary",
    behaviorAt: (n) => RATE_LIMIT_ERR(n),
  });
  const fallback = makeFake({
    name: "fallback",
    behaviorAt: () => ({ kind: "ok", delayMs: 50 }),
  });
  const config: HardenConfig = {
    maxConcurrency: 20,
    queueTimeoutMs: 5_000,
    queueMaxDepth: 100,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 1_000,
  };
  const hardened = hardenAnthropicModel(primary, fallback, config);
  resetClock();
  log("FIRE", "15 calls serially (space out 429s so threshold triggers)");
  const outcomes: CallOutcome[] = [];
  for (let i = 0; i < 15; i++) {
    const start = Date.now();
    try {
      const result = await hardened.doGenerate({
        prompt: [],
        maxOutputTokens: 8,
      } as unknown as LanguageModelV3CallOptions);
      const metadata = result.providerMetadata as
        | { storyos?: { usedFallback?: boolean; fallbackReason?: string } }
        | undefined;
      const reason = metadata?.storyos?.fallbackReason ?? "primary";
      const provider = result.content[0]?.type === "text" ? result.content[0].text : "";
      log(
        "CALL",
        `#${i + 1} ok  reason=${reason}  provider="${provider}"  (${Date.now() - start}ms)`
      );
      outcomes.push({
        callNo: i,
        ok: true,
        provider,
        usedFallback: metadata?.storyos?.usedFallback === true,
        latencyMs: Date.now() - start,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "Unknown";
      log("CALL", `#${i + 1} ERR ${name}  (${Date.now() - start}ms)`);
      outcomes.push({
        callNo: i,
        ok: false,
        provider: "",
        usedFallback: false,
        latencyMs: Date.now() - start,
        error: name,
      });
    }
  }
  summarize("scenario 3", outcomes);
}

async function scenario4_circuitRecovery(): Promise<void> {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Scenario 4: 熔断恢复");
  console.log("config: threshold=5 cooldown=1s; primary 前 5 次 429，之后成功");
  console.log("期望：5 次失败 → OPEN → 冷却期全部 fallback → 1s 后 HALF_OPEN 探测成功 → CLOSED");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  _resetSharedStateForTests();
  const primary = makeFake({
    name: "primary",
    behaviorAt: (n) => (n < 5 ? RATE_LIMIT_ERR(n) : { kind: "ok", delayMs: 10 }),
  });
  const fallback = makeFake({
    name: "fallback",
    behaviorAt: () => ({ kind: "ok", delayMs: 50 }),
  });
  const config: HardenConfig = {
    maxConcurrency: 20,
    queueTimeoutMs: 5_000,
    queueMaxDepth: 100,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 1_000,
  };
  const hardened = hardenAnthropicModel(primary, fallback, config);
  resetClock();
  log("FIRE", "Phase A: 5 calls (expect all to fail+fallback, trip breaker)");
  for (let i = 0; i < 5; i++) {
    const result = await hardened.doGenerate({
      prompt: [],
      maxOutputTokens: 8,
    } as unknown as LanguageModelV3CallOptions);
    const metadata = result.providerMetadata as
      | { storyos?: { usedFallback?: boolean; fallbackReason?: string } }
      | undefined;
    log("CALL", `#${i + 1}  reason=${metadata?.storyos?.fallbackReason ?? "primary"}`);
  }
  log("WAIT", "during cooldown — 3 calls should short-circuit to fallback fast");
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    const result = await hardened.doGenerate({
      prompt: [],
      maxOutputTokens: 8,
    } as unknown as LanguageModelV3CallOptions);
    const metadata = result.providerMetadata as
      | { storyos?: { usedFallback?: boolean; fallbackReason?: string } }
      | undefined;
    log(
      "CALL",
      `#C${i + 1}  reason=${metadata?.storyos?.fallbackReason ?? "primary"}  (${Date.now() - start}ms)`
    );
  }
  log("WAIT", "sleeping 1.1s for cooldown to elapse…");
  await sleep(1100);
  log("FIRE", "Phase B: 3 calls after cooldown — first probes HALF_OPEN");
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    const result = await hardened.doGenerate({
      prompt: [],
      maxOutputTokens: 8,
    } as unknown as LanguageModelV3CallOptions);
    const metadata = result.providerMetadata as
      | { storyos?: { usedFallback?: boolean; fallbackReason?: string } }
      | undefined;
    const provider = result.content[0]?.type === "text" ? result.content[0].text : "";
    log(
      "CALL",
      `#R${i + 1}  reason=${metadata?.storyos?.fallbackReason ?? "primary"}  provider="${provider}"  (${Date.now() - start}ms)`
    );
  }
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const requested = process.argv
    .slice(2)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 4);
  const want = (n: number) => requested.length === 0 || requested.includes(n);

  if (want(1)) await scenario1_pureQueueing();
  if (want(2)) await scenario2_queueTimeoutFallback();
  if (want(3)) await scenario3_circuitTrip();
  if (want(4)) await scenario4_circuitRecovery();
  console.log("\nDone. No real LLM was called. All behaviour came from in-process mocks.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
