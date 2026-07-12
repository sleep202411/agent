import assert from "node:assert/strict";
import test from "node:test";
import { RunnerError } from "./errors";
import { __test, resolveFizzdragonCloudConfig } from "./fizzdragon-cloud";

const WORKSPACE_ID = "019eb3d0-171c-7333-ba8f-3f070775364d";

test("cloud config fails loud and enforces low-frequency polling", () => {
  assert.throws(() => resolveFizzdragonCloudConfig({}), /FIZZDRAGON_SATOKEN/);
  assert.throws(
    () =>
      resolveFizzdragonCloudConfig({
        FIZZDRAGON_SATOKEN: "temporary-test-token",
        FIZZDRAGON_WORKSPACE_ID: WORKSPACE_ID,
        FIZZDRAGON_POLL_INTERVAL_MS: "4999",
      }),
    /5000-60000/
  );
  const config = resolveFizzdragonCloudConfig({
    FIZZDRAGON_SATOKEN: "temporary-test-token",
    FIZZDRAGON_WORKSPACE_ID: WORKSPACE_ID,
  });
  assert.equal(config.baseUrl, "https://studio.fizzdragon.com");
  assert.equal(config.pollIntervalMs, 5_000);
  assert.equal(config.jobTimeoutMs, 1_800_000);
});

test("signed upload URLs reject local, private and non-HTTPS targets", () => {
  assert.doesNotThrow(() =>
    __test.assertExternalHttpsUrl("https://bucket.example.com/object?signature=hidden")
  );
  assert.throws(() => __test.assertExternalHttpsUrl("http://bucket.example.com/object"));
  assert.throws(() => __test.assertExternalHttpsUrl("https://127.0.0.1/object"));
  assert.throws(() => __test.assertExternalHttpsUrl("https://192.168.1.5/object"));
});

test("cloud output resolves relative access URLs but rejects foreign hosts", () => {
  const api = cloudApi(async () => new Response("{}"));
  assert.equal(
    api.resolveOutputUrl("/aurora/media/assets/019f50f6-c8aa-71ad-83b9-3a08a97c35e0/content"),
    "https://studio.fizzdragon.com/aurora/media/assets/019f50f6-c8aa-71ad-83b9-3a08a97c35e0/content"
  );
  assert.equal(
    api.resolveOutputUrl("https://media.fizzdragon.com/generated/output.jpg"),
    "https://media.fizzdragon.com/generated/output.jpg"
  );
  assert.throws(() => api.resolveOutputUrl("https://attacker.example/output.jpg"));
});

test("job polling waits at least five seconds and stops at completion", async () => {
  const statuses = ["in_queue", "in_progress", "completed"];
  const sleeps: number[] = [];
  let calls = 0;
  const api = cloudApi(async (input) => {
    assert.match(String(input), /^https:\/\/studio\.fizzdragon\.com\/aurora\/ai\/jobs\//);
    const status = statuses[calls++]!;
    return new Response(JSON.stringify({ code: 200, data: { id: WORKSPACE_ID, status } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const job = await api.waitForJob(WORKSPACE_ID, 60_000, async (milliseconds) => {
    sleeps.push(milliseconds);
  });
  assert.equal(job.status, "completed");
  assert.deepEqual(sleeps, [5_000, 5_000]);
  assert.equal(calls, 3);
});

test("virtual portrait polling waits for every media mirror to become active", async () => {
  const assetId = "019f5124-1855-706a-a7b8-40ad26713d06";
  const sleeps: number[] = [];
  let calls = 0;
  const api = cloudApi(async (input, init) => {
    assert.equal(
      String(input),
      "https://studio.fizzdragon.com/aurora/media/provider-assets/status"
    );
    assert.equal(init?.method, "POST");
    calls += 1;
    const status = calls === 1 ? "processing" : "active";
    return new Response(
      JSON.stringify({
        code: 200,
        data: { assets: [{ assetId, status, updatedAt: new Date(0).toISOString() }] },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  });
  await api.waitForProviderAssets([assetId], 60_000, async (milliseconds) => {
    sleeps.push(milliseconds);
  });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [5_000]);
});

test("API errors never expose the session token or upstream body", async () => {
  const api = cloudApi(
    async () =>
      new Response(JSON.stringify({ code: 500, msg: "secret upstream detail" }), { status: 500 })
  );
  await assert.rejects(api.get("/aurora/ai/models"), (error: unknown) => {
    assert.ok(error instanceof RunnerError);
    assert.equal(error.message.includes("temporary-test-token"), false);
    assert.equal(error.message.includes("secret upstream detail"), false);
    return true;
  });
});

function cloudApi(fetchImpl: typeof fetch) {
  return new __test.FizzdragonApi(
    {
      baseUrl: "https://studio.fizzdragon.com",
      satoken: "temporary-test-token",
      workspaceId: WORKSPACE_ID,
      pollIntervalMs: 5_000,
      jobTimeoutMs: 60_000,
    },
    fetchImpl
  );
}
