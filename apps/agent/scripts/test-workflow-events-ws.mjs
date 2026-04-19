#!/usr/bin/env node
/**
 * E2E smoke test for the workflow-events WebSocket stack.
 *
 * Exercises the four critical paths the design doc (docs/workflow-events-ws.md)
 * calls out: live event stream, heartbeat, policy close, and manual publish.
 *
 * Assumes localhost dev env — Nest on :3001, Mastra on :4111, Redis on :6379.
 * Run with:  node apps/agent/scripts/test-workflow-events-ws.mjs
 */

import WebSocket from "ws";
import { execSync } from "child_process";

const NEST_URL = "http://localhost:3000"; // via Next.js rewrite
const WS_URL = "ws://localhost:3001/aurora/workflow-events";
const COOKIE = "satoken=1a8e2039-0176-44d9-a313-a8808f1e99a5";
const PROJECT_ID = "533341398968311912";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};
const log = {
  pass: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  fail: (msg) => console.log(`${colors.red}✗ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.cyan}▸${colors.reset} ${msg}`),
  dim: (msg) => console.log(`${colors.dim}  ${msg}${colors.reset}`),
};

function connect(runId, { waitForFirstMsg = true } = {}) {
  return new Promise((resolve, reject) => {
    const url = `${WS_URL}?runId=${encodeURIComponent(runId)}&projectId=${PROJECT_ID}`;
    const ws = new WebSocket(url, { headers: { cookie: COOKIE } });
    const frames = [];
    ws.on("message", (d) => {
      const frame = JSON.parse(d.toString());
      frames.push(frame);
      if (waitForFirstMsg && frames.length === 1) {
        resolve({ ws, frames });
      }
    });
    ws.on("close", (code, reason) => {
      if (!waitForFirstMsg) resolve({ ws, frames, closeCode: code, closeReason: reason.toString() });
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function startWorkflow(workflowName, inputData) {
  const body = JSON.stringify({ projectId: PROJECT_ID, workflowName, inputData });
  const { runId } = JSON.parse(
    execSync(
      `curl -s -X POST "${NEST_URL}/aurora/workflow/start" -H "Content-Type: application/json" -b "${COOKIE}" -d '${body}'`
    ).toString()
  );
  return runId;
}

function redisPublish(runId, event) {
  const payload = JSON.stringify(event).replace(/'/g, "'\\''");
  const channel = `workflow:events:${runId}`;
  execSync(
    `docker exec redis redis-cli PUBLISH '${channel}' '${payload}' > /dev/null`
  );
}

// ─── Test 1: Live event stream ─────────────────────────────────────────

async function testLiveStream() {
  log.info("Test 1: Live event stream end-to-end");
  const runId = startWorkflow("story_outline", { text: "A ghost haunts a library." });
  log.dim(`Started runId=${runId}`);

  const { ws, frames } = await connect(runId);
  log.dim(`Got first frame: ${frames[0].event}`);

  // Listen for 4 seconds — story_outline should emit progress + completed.
  await new Promise((r) => setTimeout(r, 4_000));

  const hbCount = frames.filter((f) => f.event === "heartbeat").length;
  const evtCount = frames.filter((f) => f.event === "workflow_event").length;
  ws.close(1000, "test_done");

  if (hbCount >= 1 && evtCount >= 1) {
    log.pass(
      `Received ${frames.length} frames (heartbeat×${hbCount}, workflow_event×${evtCount})`
    );
  } else {
    log.fail(`Expected heartbeat + event; got hb=${hbCount} evt=${evtCount}`);
    console.log(frames);
  }
}

// ─── Test 2: Manual publish fan-out ────────────────────────────────────

async function testManualPublish() {
  log.info("Test 2: Manual Redis publish → WS fan-out");
  const runId = startWorkflow("story_outline", { text: "Manual publish test." });
  const { ws } = await connect(runId);

  const testId = `manual-${Date.now()}`;
  redisPublish(runId, {
    id: testId,
    runId,
    timestamp: Date.now(),
    type: "progress",
    data: { stepId: "custom", current: 42, total: 100, label: "from test" },
  });

  const received = await new Promise((resolve) => {
    const captured = [];
    const handler = (d) => {
      const frame = JSON.parse(d.toString());
      captured.push(frame);
      if (frame.event === "workflow_event" && frame.data.id === testId) {
        ws.off("message", handler);
        resolve(frame);
      }
    };
    ws.on("message", handler);
    setTimeout(() => resolve(null), 2_000);
  });

  ws.close(1000, "test_done");

  if (received) {
    log.pass(`Fan-out delivered id=${testId} current=${received.data.data.current}`);
  } else {
    log.fail(`Manual publish NOT received within 2s`);
  }
}

// ─── Test 3: Auth / policy rejection ───────────────────────────────────

async function testPolicyClose() {
  log.info("Test 3: Policy rejection (nonexistent runId)");
  const fakeRunId = "does-not-exist-runid";
  try {
    const { closeCode, closeReason, frames } = await connect(fakeRunId, {
      waitForFirstMsg: false,
    });
    if (closeCode === 1008 && frames[0]?.event === "terminate") {
      log.pass(`Got close 1008 with terminate frame reason=${frames[0].data.reason}`);
    } else {
      log.fail(
        `Expected 1008 + terminate; got code=${closeCode} reason=${closeReason} first=${frames[0]?.event}`
      );
    }
  } catch (err) {
    log.fail(`Connection error: ${err.message}`);
  }
}

// ─── Test 4: Missing params ────────────────────────────────────────────

async function testMissingParams() {
  log.info("Test 4: Missing runId parameter");
  const url = `${WS_URL}?projectId=${PROJECT_ID}`;
  await new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { cookie: COOKIE } });
    const frames = [];
    ws.on("message", (d) => frames.push(JSON.parse(d.toString())));
    ws.on("close", (code, reason) => {
      if (code === 1008) log.pass(`Missing param rejected with 1008`);
      else log.fail(`Expected 1008; got ${code} ${reason.toString()}`);
      resolve();
    });
    ws.on("error", () => {
      log.fail("Socket errored out");
      resolve();
    });
    setTimeout(resolve, 3_000);
  });
}

// ─── Main ──────────────────────────────────────────────────────────────

(async () => {
  try {
    await testLiveStream();
    await testManualPublish();
    await testPolicyClose();
    await testMissingParams();
    console.log(`\n${colors.green}All tests finished.${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}Fatal: ${err.message}${colors.reset}`);
    process.exit(1);
  }
})();
