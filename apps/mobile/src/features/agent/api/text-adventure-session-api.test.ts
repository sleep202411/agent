import { beforeEach, expect, it, vi } from "vitest";
import {
  getPlayingTextAdventureSession,
  startTextAdventureSession,
  sendTextAdventureAction,
} from "./text-adventure-session-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  stream: vi.fn(),
  generation: 1,
  chunks: [] as string[],
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get }, postApiStream: h.stream }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const gameId = "tg_0123456789abcdef",
  sessionId = "ts_0123456789abcdef";
const account = { userId: "1", generation: 1 };
const signal = () => new AbortController().signal;
const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const meta = {
  gameId,
  sessionId,
  resumed: false,
  startedAt: "2026-10-01T00:00:00Z",
  bgmUrl: null,
  stillUrls: [],
};
const done = { sessionId, messageId: "2", content: "Hello" };
const chatMeta = {
  sessionId,
  userMessage: { id: "1", role: "user", content: "Look", createdAt: "2026-10-01T00:00:00Z" },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.chunks = [];
  h.stream.mockImplementation(async (_path, _config, onChunk) => {
    for (const chunk of h.chunks) onChunk(chunk);
  });
});
it("starts a new session with streamed deltas and a final validated message", async () => {
  const raw =
    frame("ready", {}) + frame("meta", meta) + frame("delta", { text: "He" }) + frame("done", done);
  h.chunks = [...raw];
  const update = vi.fn();
  const result = await startTextAdventureSession(gameId, "en-US", account, signal(), update);
  expect(result.messages[0]).toMatchObject({ id: "2", content: "Hello" });
  expect(update).toHaveBeenCalledTimes(3);
  expect(h.stream.mock.calls[0][0]).toBe(`/api/player/text-game/${gameId}/start/stream`);
});
it("accepts split CRLF frames and forwards the requested locale", async () => {
  h.chunks = [...(frame("meta", meta) + frame("done", done)).replace(/\n/g, "\r\n")];
  await startTextAdventureSession(gameId, "zh-HK", account, signal());
  expect(h.stream.mock.calls[0][1].data).toEqual({ locale: "zh-HK" });
});
it.each([
  [frame("meta", { ...meta, gameId: "tg_fedcba9876543210" }), "Unexpected"],
  [frame("meta", { ...meta, resumed: true }), "Unexpected"],
  [frame("delta", { text: "Hi" }), "before session metadata"],
  [frame("meta", meta), "before completion"],
  [frame("meta", meta) + frame("meta", meta), "Duplicate"],
  [frame("meta", meta) + frame("done", { ...done, sessionId: "ts_fedcba9876543210" }), "mismatch"],
  [
    frame("meta", meta) + frame("done", done) + frame("delta", { text: "late" }),
    "after completion",
  ],
  ["event: meta\ndata: not-json\n\n", "Invalid"],
  [frame("meta", meta) + frame("done", done) + "data: {", "incomplete event"],
  [frame("error", { msg: "Insufficient credits" }), "Insufficient credits"],
])("rejects invalid or unfinished start stream %#", async (raw, error) => {
  h.chunks = [raw];
  await expect(startTextAdventureSession(gameId, "en-US", account, signal())).rejects.toThrow(
    error
  );
  expect(h.stream).toHaveBeenCalledOnce();
});
it("gets an existing session without starting one and validates game, resumed state and message IDs", async () => {
  h.get.mockResolvedValue(null);
  expect(await getPlayingTextAdventureSession(gameId, account, signal())).toBeNull();
  expect(h.stream).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ ...meta, resumed: true, messages: [] });
  expect(await getPlayingTextAdventureSession(gameId, account, signal())).toMatchObject({
    sessionId,
  });
  h.get.mockResolvedValue({ ...meta, resumed: true, gameId: "tg_fedcba9876543210" });
  await expect(getPlayingTextAdventureSession(gameId, account, signal())).rejects.toThrow(
    "Unexpected"
  );
  h.get.mockResolvedValue({
    ...meta,
    resumed: true,
    messages: [chatMeta.userMessage, chatMeta.userMessage],
  });
  await expect(getPlayingTextAdventureSession(gameId, account, signal())).rejects.toThrow(
    "Duplicate"
  );
});
it("sends one action and exposes only validated user/delta/final messages", async () => {
  h.chunks = [frame("meta", chatMeta), frame("delta", { text: "He" }), frame("done", done)];
  const handlers = { onUserMessage: vi.fn(), onAssistantDelta: vi.fn(), onAssistantDone: vi.fn() };
  const result = await sendTextAdventureAction(
    sessionId,
    " Look ",
    "en-US",
    account,
    signal(),
    handlers
  );
  expect(result).toMatchObject({
    sessionId,
    userMessage: { id: "1" },
    assistantMessage: { id: "2" },
  });
  expect(h.stream.mock.calls[0][1].data.message).toBe("Look");
  expect(handlers.onAssistantDelta).toHaveBeenCalledWith("He");
});
it.each([
  [frame("done", done), "before chat metadata"],
  [frame("meta", chatMeta), "before completion"],
  [frame("meta", { ...chatMeta, sessionId: "ts_fedcba9876543210" }), "mismatch"],
  [frame("meta", chatMeta) + frame("done", { ...done, messageId: "1" }), "identity mismatch"],
])("rejects invalid chat streams %#", async (raw, error) => {
  h.chunks = [raw];
  await expect(
    sendTextAdventureAction(sessionId, "Look", "en-US", account, signal())
  ).rejects.toThrow(error);
});
it("blocks old-account stream callbacks and pre-cancelled requests", async () => {
  const onSession = vi.fn();
  h.stream.mockImplementation(async (_p, _c, callback) => {
    h.generation = 2;
    callback(frame("meta", meta));
  });
  await expect(
    startTextAdventureSession(gameId, "en-US", account, signal(), onSession)
  ).rejects.toThrow("account changed");
  expect(onSession).not.toHaveBeenCalled();
  h.generation = 1;
  h.stream.mockClear();
  const c = new AbortController();
  c.abort();
  await expect(startTextAdventureSession(gameId, "en-US", account, c.signal)).rejects.toThrow();
  expect(h.stream).not.toHaveBeenCalled();
});

it("accepts a UTF-8 BOM before the first event", async () => {
  h.chunks = ["", "\uFEFF", frame("meta", meta), frame("done", done)];
  expect((await startTextAdventureSession(gameId, "en-US", account, signal())).sessionId).toBe(
    sessionId
  );
});
