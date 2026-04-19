#!/usr/bin/env node
/**
 * 500-user capacity load test (localhost).
 *
 * Three representative workloads hammering the v3 stack at 500 concurrency:
 *
 *   1. HTTP polling: GET /aurora/assets/image-status
 *      exercises Nest AuthGuard → Mastra middleware → Redis HGETALL
 *   2. HTTP POST:    POST /aurora/workflow/start with invalid workflowName
 *      exercises Nest routing → Mastra validation (400 path — no workflow
 *      actually enqueued, so we don't burn LLM tokens on the test run)
 *   3. WebSocket:    500 parallel handshakes to /aurora/workflow-events
 *      exercises @nestjs/platform-ws + AuthService + meta lookup (server
 *      sends {terminate, 1008} quickly; measures accept + reject rate)
 *
 * We report count / success / p50 / p95 / p99 / max latency per test.
 * On localhost these numbers bound the stack's shape; production numbers
 * will differ (TLS, network RTT, load balancer overhead, etc.) but the
 * ratios and error modes are diagnostic.
 *
 * Usage:
 *   node apps/agent/scripts/load-test.mjs
 *   CONCURRENCY=1000 node apps/agent/scripts/load-test.mjs
 */

import WebSocket from "ws";

const BASE_HTTP = process.env.BASE_HTTP ?? "http://localhost:3000";
const BASE_WS = process.env.BASE_WS ?? "ws://localhost:3001";
const COOKIE = process.env.COOKIE ?? "satoken=1a8e2039-0176-44d9-a313-a8808f1e99a5";
const PROJECT_ID = process.env.PROJECT_ID ?? "533341398968311912";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 500);

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[i];
}

function summary(durations) {
  if (durations.length === 0) return { n: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: Math.round(sum / sorted.length),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };
}

function fmt(stat) {
  if (stat.n === 0) return "no samples";
  return `mean=${stat.mean}ms p50=${stat.p50}ms p95=${stat.p95}ms p99=${stat.p99}ms max=${stat.max}ms`;
}

function banner(title, n) {
  console.log(`\n${colors.bold}${colors.cyan}▸ ${title} × ${n}${colors.reset}`);
}

function result(ok, stat, wall) {
  const rate = (ok / stat.n) * 100;
  const color =
    rate >= 99 ? colors.green : rate >= 95 ? colors.yellow : colors.red;
  console.log(
    `  ${color}${ok}/${stat.n} OK (${rate.toFixed(1)}%)${colors.reset}  wall=${wall}ms  ${fmt(stat)}`
  );
}

// ─── Test 1: HTTP polling ─────────────────────────────────────────────

async function testPolling() {
  banner("GET /assets/image-status", CONCURRENCY);
  const start = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, async () => {
      const t0 = Date.now();
      try {
        const resp = await fetch(
          `${BASE_HTTP}/aurora/assets/image-status?projectId=${PROJECT_ID}`,
          { headers: { cookie: COOKIE } }
        );
        await resp.text(); // drain body to not skew timings
        return { ok: resp.ok, dt: Date.now() - t0, status: resp.status };
      } catch (err) {
        return { ok: false, dt: Date.now() - t0, error: err.message };
      }
    })
  );
  const values = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const ok = values.filter((v) => v.ok).length;
  const durations = values.map((v) => v.dt);
  result(ok, summary(durations), Date.now() - start);
  if (ok < CONCURRENCY) {
    const errs = values.filter((v) => !v.ok).slice(0, 3);
    console.log(`  ${colors.dim}errors: ${JSON.stringify(errs)}${colors.reset}`);
  }
}

// ─── Test 2: POST validation path ─────────────────────────────────────

async function testWorkflowStartValidation() {
  banner("POST /workflow/start (invalid workflowName → 400)", CONCURRENCY);
  const start = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: CONCURRENCY }, async () => {
      const t0 = Date.now();
      try {
        const resp = await fetch(`${BASE_HTTP}/aurora/workflow/start`, {
          method: "POST",
          headers: { cookie: COOKIE, "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: PROJECT_ID,
            workflowName: "not_a_real_workflow_load_test",
            inputData: {},
          }),
        });
        await resp.text();
        // 400 is the correct response for this invalid payload — counts as OK
        // because it means the stack processed the request and rejected it
        // (what we want to measure: can the stack handle N req/s of valid
        // shape without crashing).
        return { ok: resp.status === 400, dt: Date.now() - t0, status: resp.status };
      } catch (err) {
        return { ok: false, dt: Date.now() - t0, error: err.message };
      }
    })
  );
  const values = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const ok = values.filter((v) => v.ok).length;
  const durations = values.map((v) => v.dt);
  result(ok, summary(durations), Date.now() - start);
  if (ok < CONCURRENCY) {
    const errs = values.filter((v) => !v.ok).slice(0, 3);
    console.log(`  ${colors.dim}errors: ${JSON.stringify(errs)}${colors.reset}`);
  }
}

// ─── Test 3: WebSocket handshake capacity ─────────────────────────────

async function testWebSocketCapacity() {
  banner("WS /workflow-events (fake runId → 1008 close)", CONCURRENCY);
  const start = Date.now();
  const openDurations = [];
  const closeDurations = [];
  const closeCodes = new Map();

  const promises = Array.from(
    { length: CONCURRENCY },
    (_, i) =>
      new Promise((resolve) => {
        const t0 = Date.now();
        let opened = false;
        const ws = new WebSocket(
          `${BASE_WS}/aurora/workflow-events?runId=load-test-${i}&projectId=${PROJECT_ID}`,
          { headers: { cookie: COOKIE } }
        );
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {}
          resolve({ ok: false, error: "timeout" });
        }, 10_000);
        ws.on("open", () => {
          opened = true;
          openDurations.push(Date.now() - t0);
        });
        ws.on("close", (code) => {
          clearTimeout(timer);
          closeDurations.push(Date.now() - t0);
          closeCodes.set(code, (closeCodes.get(code) ?? 0) + 1);
          resolve({ ok: opened, code, dt: Date.now() - t0 });
        });
        ws.on("error", () => {
          clearTimeout(timer);
          resolve({ ok: false, error: "ws_error" });
        });
      })
  );

  const results = await Promise.all(promises);
  const ok = results.filter((r) => r.ok).length;
  const wall = Date.now() - start;
  console.log(
    `  ${ok >= CONCURRENCY * 0.99 ? colors.green : colors.yellow}${ok}/${CONCURRENCY} handshakes OK${colors.reset}  wall=${wall}ms`
  );
  console.log(`  ${colors.dim}open latency:  ${fmt(summary(openDurations))}${colors.reset}`);
  console.log(`  ${colors.dim}close latency: ${fmt(summary(closeDurations))}${colors.reset}`);
  console.log(
    `  ${colors.dim}close codes: ${[...closeCodes.entries()].map(([c, n]) => `${c}×${n}`).join(" ")}${colors.reset}`
  );
}

// ─── Main ─────────────────────────────────────────────────────────────

(async () => {
  console.log(
    `${colors.bold}Load test — concurrency=${CONCURRENCY}${colors.reset} ` +
      `${colors.dim}(BASE_HTTP=${BASE_HTTP} BASE_WS=${BASE_WS})${colors.reset}`
  );
  await testPolling();
  await testWorkflowStartValidation();
  await testWebSocketCapacity();
  console.log(`\n${colors.green}Done.${colors.reset}`);
})();
