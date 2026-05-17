// Verify foundry-job-update push flow:
//   1. Browser connects to assets hub via /realtime/negotiate/assets
//   2. POST /foundry/jobs (which triggers emitJobUpdate inside Nest)
//   3. Expect a `foundry_job_update` event to land on the assets group

import WebSocket from "ws";

const NEST_URL = process.env.NEST_URL ?? "http://localhost:3002";

async function main() {
  console.log("→ negotiating assets client token...");
  const res = await fetch(`${NEST_URL}/realtime/negotiate/assets`, {
    method: "POST",
  });
  const body = await res.json();
  if (body.code !== 200) throw new Error(`negotiate: ${JSON.stringify(body)}`);

  console.log("→ connecting to Azure (assets hub)...");
  const ws = new WebSocket(body.data.url, "json.webpubsub.azure.v1");
  await new Promise((r, j) => {
    ws.on("open", r);
    ws.on("error", j);
    setTimeout(() => j(new Error("connect timeout")), 10_000);
  });
  console.log("✓ ws open");

  const received = [];
  ws.on("message", (raw) => {
    const text = raw.toString();
    console.log(`← ${text}`);
    try {
      received.push(JSON.parse(text));
    } catch {}
  });

  await new Promise((r) => setTimeout(r, 500));

  console.log("→ POST /foundry/jobs with a minimal payload...");
  const submitRes = await fetch(`${NEST_URL}/foundry/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId: "foundry/gpt-image-2",
      schemaVersion: "2026-05-16",
      input: { prompt: "verify-foundry-push smoke test" },
    }),
  });
  const submitBody = await submitRes.json();
  console.log(`✓ submit response: code=${submitBody.code} id=${submitBody.data?.request_id ?? "?"}`);

  await new Promise((r) => setTimeout(r, 2_000));

  const got = received.find(
    (m) =>
      m?.type === "message" &&
      m?.from === "group" &&
      m?.data?.kind === "foundry_job_update"
  );

  if (got) {
    console.log("\n🎉 SUCCESS — foundry submit triggered a push");
    console.log(`  job.id    = ${got.data.job.id}`);
    console.log(`  job.status= ${got.data.job.status}`);
    console.log(`  job.stage = ${got.data.job.stage}`);
    process.exit(0);
  } else {
    console.error("\n❌ FAIL — no foundry_job_update push received");
    console.error("All ws messages:");
    console.error(JSON.stringify(received, null, 2));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("error:", err.message);
  process.exit(1);
});
