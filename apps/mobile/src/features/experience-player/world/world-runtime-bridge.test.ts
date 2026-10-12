import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorldRuntimeBridge } from "./world-runtime-bridge";
import { worldRuntimeHtml, worldRuntimeInjection } from "./world-runtime-document";
import type { WorldCommand } from "../../../../world-player/protocol";
const sessionId = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const input = {
  providerKey: "fal:happy-oyster" as const,
  connection: {
    apiBaseUrl: "https://provider.example/api",
    token: "fixture-token",
    ticket: "fixture-ticket",
    tokenExpiresIn: 60,
  },
  maxExperienceSeconds: 90 as const,
};
let bridge: WorldRuntimeBridge;
let messages: WorldCommand[];
const reply = (requestId: string, value?: unknown) =>
  bridge.receive(JSON.stringify({ sessionId, type: "result", requestId, value }));
beforeEach(() => {
  vi.useFakeTimers();
  messages = [];
  bridge = new WorldRuntimeBridge(sessionId, (m) => messages.push(m));
});
afterEach(() => {
  bridge.detach();
  vi.useRealTimers();
});
async function initialize() {
  bridge.receive(JSON.stringify({ sessionId, type: "ready" }));
  const pending = bridge.initialize(input);
  await Promise.resolve();
  reply(messages[0].requestId);
  await pending;
}
it("waits for this document and correlates out-of-order replies", async () => {
  const pending = bridge.initialize(input);
  bridge.receive(JSON.stringify({ sessionId: other, type: "ready" }));
  await Promise.resolve();
  expect(messages).toHaveLength(0);
  bridge.receive(JSON.stringify({ sessionId, type: "ready" }));
  await Promise.resolve();
  reply(messages[0].requestId);
  await pending;
  const a = bridge.move({ movement: "forward" });
  const b = bridge.pause();
  reply(messages[2].requestId);
  await b;
  reply(messages[1].requestId);
  await a;
});
it("rejects a mismatched document response and does not resubmit a timed-out start", async () => {
  await initialize();
  const pending = bridge.start();
  const failure = expect(pending).rejects.toThrow("result is unknown");
  bridge.receive(
    JSON.stringify({
      sessionId: other,
      type: "result",
      requestId: messages[1].requestId,
      value: {},
    })
  );
  await vi.advanceTimersByTimeAsync(120000);
  await failure;
  expect(messages.filter((m) => m.type === "start")).toHaveLength(1);
});
it("validates provider start results and preserves explicit failures", async () => {
  await initialize();
  const start = bridge.start();
  reply(messages.at(-1)!.requestId, {
    providerTravelId: "travel",
    firstFrameUrl: null,
    maxExperienceSeconds: 90,
  });
  await expect(start).resolves.toMatchObject({ providerTravelId: "travel" });
  const move = bridge.move({ look: "up" });
  bridge.receive(
    JSON.stringify({
      sessionId,
      type: "failure",
      requestId: messages.at(-1)!.requestId,
      message: "Movement refused",
      name: "ProviderError",
    })
  );
  await expect(move).rejects.toMatchObject({ message: "Movement refused", name: "ProviderError" });
});
it("drops malformed and late events after detachment", async () => {
  const status = vi.fn();
  bridge.receive(JSON.stringify({ sessionId, type: "ready" }));
  const pending = bridge.initialize({ ...input, events: { onStatusChange: status } });
  await Promise.resolve();
  reply(messages[0].requestId);
  await pending;
  bridge.receive("bad json");
  bridge.receive(JSON.stringify({ sessionId, type: "status", status: "UNKNOWN" }));
  bridge.receive(JSON.stringify({ sessionId, type: "status", status: "PLAYING" }));
  expect(status).toHaveBeenCalledOnce();
  const move = bridge.move({ movement: "forward" });
  bridge.detach();
  await expect(move).rejects.toThrow("removed");
  bridge.receive(JSON.stringify({ sessionId, type: "status", status: "PAUSED" }));
  expect(status).toHaveBeenCalledOnce();
});
it("shares in-flight disposal and allows explicit cleanup retry after failure", async () => {
  await initialize();
  const first = bridge.dispose();
  expect(bridge.dispose()).toBe(first);
  bridge.receive(
    JSON.stringify({
      sessionId,
      type: "failure",
      requestId: messages.at(-1)!.requestId,
      message: "Close failed",
    })
  );
  await expect(first).rejects.toThrow("Close failed");
  const retry = bridge.dispose();
  reply(messages.at(-1)!.requestId);
  await retry;
  await expect(bridge.start()).rejects.toThrow("closed");
});
it("fails initialization if the document never reports ready", async () => {
  const pending = bridge.initialize(input);
  const failure = expect(pending).rejects.toThrow("did not load");
  await vi.advanceTimersByTimeAsync(15000);
  await failure;
  expect(messages).toHaveLength(0);
});
it("embeds no connection credentials and escapes injected command text", () => {
  const html = worldRuntimeHtml(sessionId);
  expect(html).not.toContain(input.connection.token);
  expect(html).not.toContain(input.connection.ticket);
  expect(html).toContain("<video playsinline>");
  const script = worldRuntimeInjection({
    sessionId,
    requestId: "1",
    type: "instruct",
    content: "</script><script>alert(1)</script>",
  });
  expect(script).not.toContain("</script>");
  expect(() => worldRuntimeHtml("</script>")).toThrow();
});
