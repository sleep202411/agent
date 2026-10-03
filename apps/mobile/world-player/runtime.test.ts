import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  factory: vi.fn(),
  runtime: {
    start: vi.fn(),
    move: vi.fn(),
    instruct: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    rewind: vi.fn(),
    updateToken: vi.fn(),
    end: vi.fn(),
    dispose: vi.fn(),
  },
}));
vi.mock("./happy-oyster-runtime", () => ({ createHappyOysterRuntime: h.factory }));
const sessionId = "11111111-1111-4111-8111-111111111111";
let replies: Record<string, unknown>[];
let pageHideListeners: EventListener[];
const send = (value: Record<string, unknown>) =>
  window.__fizzWorldReceive!(JSON.stringify({ sessionId, ...value }));
const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  replies = [];
  pageHideListeners = [];
  const addListener = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "pagehide") pageHideListeners.push(listener as EventListener);
    addListener(type, listener, options);
  });
  h.factory.mockResolvedValue(h.runtime);
  h.runtime.dispose.mockResolvedValue(undefined);
  document.body.innerHTML = `<video></video><script data-initial type="application/json">${JSON.stringify({ sessionId })}</script>`;
  window.ReactNativeWebView = { postMessage: (raw) => replies.push(JSON.parse(raw)) };
  await import("./runtime");
  send({
    type: "initialize",
    requestId: "init",
    providerKey: "fal:happy-oyster",
    connection: {
      apiBaseUrl: "https://fixture.invalid",
      token: "fixture",
      ticket: "fixture",
      tokenExpiresIn: 60,
    },
    maxExperienceSeconds: 90,
  });
  await settle();
});
afterEach(async () => {
  window.dispatchEvent(new Event("pagehide"));
  await settle();
  for (const listener of pageHideListeners) window.removeEventListener("pagehide", listener);
  vi.restoreAllMocks();
  delete window.ReactNativeWebView;
  delete window.__fizzWorldReceive;
});

it("serializes start and movement and never executes a replayed Start twice", async () => {
  let finish!: (value: unknown) => void;
  h.runtime.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  send({ type: "start", requestId: "start" });
  send({ type: "start", requestId: "start" });
  send({ type: "move", requestId: "move", command: { movement: "forward" } });
  await settle();
  expect(h.runtime.start).toHaveBeenCalledOnce();
  expect(h.runtime.move).not.toHaveBeenCalled();
  finish({ providerTravelId: "travel", firstFrameUrl: null, maxExperienceSeconds: 90 });
  await settle();
  expect(h.runtime.move).toHaveBeenCalledWith({ movement: "forward" });
  expect(replies.filter((r) => r.requestId === "start")).toHaveLength(1);
});
it("rejects unknown commands, invalid movement, and another document's session", async () => {
  send({ type: "eval", requestId: "bad", code: "alert(1)" });
  send({ type: "move", requestId: "bad2", command: { movement: "teleport" } });
  send({ type: "start", requestId: "foreign", sessionId: "22222222-2222-4222-8222-222222222222" });
  await settle();
  expect(h.runtime.start).not.toHaveBeenCalled();
  expect(h.runtime.move).not.toHaveBeenCalled();
  expect(replies.filter((r) => r.requestId && r.requestId !== "init")).toEqual([]);
});
it("keeps failed disposal retryable but retires the document after successful cleanup", async () => {
  h.runtime.dispose.mockRejectedValueOnce(new Error("Close refused"));
  send({ type: "dispose", requestId: "close1" });
  await settle();
  expect(replies.find((r) => r.requestId === "close1")).toMatchObject({
    type: "failure",
    message: "Close refused",
  });
  send({ type: "dispose", requestId: "close2" });
  await settle();
  expect(replies.find((r) => r.requestId === "close2")).toMatchObject({ type: "result" });
  send({ type: "start", requestId: "after" });
  await settle();
  expect(h.runtime.start).not.toHaveBeenCalled();
});
it("forwards provider status and explicit errors without provider credentials", () => {
  const input = h.factory.mock.calls[0][0];
  input.events.onStatusChange("PLAYING");
  input.events.onError(new Error("Stream interrupted"));
  expect(replies).toEqual(
    expect.arrayContaining([
      { sessionId, type: "status", status: "PLAYING" },
      { sessionId, type: "error", name: "Error", message: "Stream interrupted" },
    ])
  );
  expect(JSON.stringify(replies)).not.toContain('"token"');
});

it("disposes an SDK acquired after the playback document has closed", async () => {
  window.dispatchEvent(new Event("pagehide"));
  await settle();
  h.runtime.dispose.mockClear();
  vi.resetModules();
  let finish!: (value: unknown) => void;
  h.factory.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await import("./runtime");
  send({
    type: "initialize",
    requestId: "late-init",
    providerKey: "fal:happy-oyster",
    connection: {
      apiBaseUrl: "https://fixture.invalid",
      token: "fixture",
      ticket: "fixture",
      tokenExpiresIn: 60,
    },
    maxExperienceSeconds: 90,
  });
  await settle();
  window.dispatchEvent(new Event("pagehide"));
  await settle();
  h.runtime.dispose.mockClear();
  finish(h.runtime);
  await settle();
  expect(h.runtime.dispose).toHaveBeenCalledOnce();
  expect(replies.find((reply) => reply.requestId === "late-init")).toMatchObject({
    type: "failure",
    message: "World runtime is closed.",
  });
  send({ type: "start", requestId: "late-start" });
  await settle();
  expect(h.runtime.start).not.toHaveBeenCalled();
});
