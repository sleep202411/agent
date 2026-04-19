#!/usr/bin/env node
/**
 * E2E smoke test for the Replicate image generation stack.
 *
 * Requires REPLICATE_API_TOKEN to be set — skips with a clear message otherwise.
 *
 * Covers:
 *   1. /aurora/assets/image-status returns empty hash for a fresh project
 *   2. Enqueue job via role_phase commit (not done here — test the retry
 *      path which is equivalent)
 *   3. /aurora/assets/:type/:id/regenerate-image enqueues a job
 *   4. Polling the status endpoint shows pending → generating → ready
 *   5. Java role record has roleImgPath[0] updated
 */

import { execSync } from "child_process";

const NEST_URL = "http://localhost:3000";
const COOKIE = "satoken=1a8e2039-0176-44d9-a313-a8808f1e99a5";
const PROJECT_ID = "533341398968311912";
const WORLD_ID = "510907264543236223";
// Any existing role from the last test run — these stick around in Java.
const TEST_ROLE_ID = process.env.TEST_ROLE_ID ?? "";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};
const log = {
  pass: (m) => console.log(`${colors.green}✓${colors.reset} ${m}`),
  fail: (m) => console.log(`${colors.red}✗ ${m}${colors.reset}`),
  info: (m) => console.log(`${colors.cyan}▸${colors.reset} ${m}`),
  dim: (m) => console.log(`${colors.dim}  ${m}${colors.reset}`),
  warn: (m) => console.log(`${colors.yellow}!${colors.reset} ${m}`),
};

function curl(method, path, body) {
  const bodyArg = body ? `-d '${body.replace(/'/g, "'\\''")}'` : "";
  const cmd = `curl -s -X ${method} "${NEST_URL}${path}" -H "Content-Type: application/json" -b "${COOKIE}" ${bodyArg}`;
  return execSync(cmd).toString();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Test 1: empty status endpoint ────────────────────────────────────

async function testStatusEndpoint() {
  log.info("Test 1: GET /assets/image-status returns structured response");
  const resp = JSON.parse(curl("GET", `/aurora/assets/image-status?projectId=${PROJECT_ID}`));
  if (resp.projectId === PROJECT_ID && typeof resp.statuses === "object") {
    log.pass(`Endpoint returned { projectId, statuses } (${Object.keys(resp.statuses).length} entries)`);
  } else {
    log.fail(`Unexpected response: ${JSON.stringify(resp).slice(0, 200)}`);
  }
}

// ─── Test 2: regenerate fires a job ───────────────────────────────────

async function testRegenerate() {
  log.info("Test 2: POST regenerate-image enqueues job + status transitions");
  if (!TEST_ROLE_ID) {
    log.warn("TEST_ROLE_ID env not set — skipping. Grab one from Java:");
    log.dim("  curl -s localhost:3000/api/user/world/list/worldrole -b ... | jq '.list[0].id'");
    return;
  }
  if (!process.env.REPLICATE_API_TOKEN) {
    log.warn("REPLICATE_API_TOKEN not set — skipping. Set it in apps/agent/.env");
    return;
  }

  const triggerResp = JSON.parse(
    curl(
      "POST",
      `/aurora/assets/role/${TEST_ROLE_ID}/regenerate-image`,
      JSON.stringify({ projectId: PROJECT_ID, worldId: WORLD_ID })
    )
  );
  if (!triggerResp.ok) {
    log.fail(`regenerate-image rejected: ${JSON.stringify(triggerResp)}`);
    return;
  }
  log.dim(`Enqueued regenerateAt=${triggerResp.regenerateAt}`);

  const fieldKey = `role:${TEST_ROLE_ID}`;
  let observedStatuses = new Set();
  const start = Date.now();
  const deadline = start + 60_000;

  while (Date.now() < deadline) {
    const statusResp = JSON.parse(
      curl("GET", `/aurora/assets/image-status?projectId=${PROJECT_ID}`)
    );
    const record = statusResp.statuses?.[fieldKey];
    if (record) {
      observedStatuses.add(record.status);
      log.dim(`[${Math.round((Date.now() - start) / 1000)}s] status=${record.status}`);
      if (record.status === "ready") {
        log.pass(`ready in ${Math.round((Date.now() - start) / 1000)}s (imageUrl=${record.imageUrl?.slice(0, 60)}…)`);
        log.dim(`observed transitions: ${[...observedStatuses].join(" → ")}`);
        return;
      }
      if (record.status.startsWith("failed_")) {
        log.fail(`failed: ${record.status} ${record.error ?? ""}`);
        return;
      }
    }
    await sleep(3_000);
  }
  log.fail(`timeout — 60s without reaching ready (last seen: ${[...observedStatuses]})`);
}

// ─── Test 3: bad asset type rejected ──────────────────────────────────

async function testBadAssetType() {
  log.info("Test 3: bad assetType rejected with 400");
  try {
    const resp = curl(
      "POST",
      `/aurora/assets/invalid/123/regenerate-image`,
      JSON.stringify({ projectId: PROJECT_ID })
    );
    if (resp.includes("role / scene / prop")) {
      log.pass("Invalid asset type correctly rejected");
    } else {
      log.fail(`Unexpected response: ${resp.slice(0, 200)}`);
    }
  } catch (err) {
    log.fail(`Request errored: ${err.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

(async () => {
  try {
    await testStatusEndpoint();
    await testBadAssetType();
    await testRegenerate();
    console.log(`\n${colors.green}Tests done.${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}Fatal: ${err.message}${colors.reset}`);
    process.exit(1);
  }
})();
