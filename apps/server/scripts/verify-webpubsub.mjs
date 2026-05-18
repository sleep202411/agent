// Verify Azure Web PubSub round-trip:
//   1. Negotiate a client token from Nest's /realtime/negotiate/entity
//   2. Connect to Azure with that token (json.webpubsub.azure.v1 subprotocol)
//   3. Server publishes via WebPubSubServiceClient to user:dev group
//   4. Connected client should receive {event:"entity_changed", data:{...}}
//
// Usage from apps/server:
//   AZURE_WEB_PUBSUB_CONNECTION_STRING=... node scripts/verify-webpubsub.mjs

import WebSocket from "ws";
import { WebPubSubServiceClient } from "@azure/web-pubsub";

const CONNECTION_STRING = process.env.AZURE_WEB_PUBSUB_CONNECTION_STRING;
if (!CONNECTION_STRING) {
  console.error("AZURE_WEB_PUBSUB_CONNECTION_STRING required");
  process.exit(1);
}
const NEST_URL = process.env.NEST_URL ?? "http://localhost:3002";

async function main() {
  console.log("→ negotiating client token from Nest...");
  const res = await fetch(`${NEST_URL}/realtime/negotiate/entity`, {
    method: "POST",
  });
  const body = await res.json();
  if (body.code !== 200) {
    throw new Error(`negotiate failed: ${JSON.stringify(body)}`);
  }
  console.log("✓ token issued");

  console.log("→ connecting WebSocket to Azure...");
  const ws = new WebSocket(body.data.url, "json.webpubsub.azure.v1");

  await new Promise((resolve, reject) => {
    ws.on("open", () => {
      console.log("✓ ws open");
      resolve();
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 10_000);
  });

  const received = [];
  ws.on("message", (raw) => {
    const text = raw.toString();
    console.log(`← ${text}`);
    try {
      received.push(JSON.parse(text));
    } catch {
      received.push({ raw: text });
    }
  });

  await new Promise((r) => setTimeout(r, 500));

  console.log("→ publishing test event to user:dev via server SDK...");
  const client = new WebPubSubServiceClient(CONNECTION_STRING, "entity");
  await client.group("user:dev").sendToAll({
    event: "entity_changed",
    data: { entity: "test", action: "ping", id: "verify-1", ts: Date.now() },
  });
  console.log("✓ publish sent");

  await new Promise((r) => setTimeout(r, 3_000));

  const got = received.find(
    (m) =>
      m?.type === "message" &&
      m?.from === "group" &&
      m?.group === "user:dev" &&
      m?.data?.event === "entity_changed",
  );

  if (got) {
    console.log("\n🎉 SUCCESS — end-to-end round trip works");
    process.exit(0);
  } else {
    console.error("\n❌ FAIL — no matching group message received");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("error:", err.message);
  process.exit(1);
});
