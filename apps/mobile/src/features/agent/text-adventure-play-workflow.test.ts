import { beforeEach, expect, it, vi } from "vitest";
import { textAdventurePlayWorkflow } from "./text-adventure-play-workflow";
const h = vi.hoisted(() => ({
  raw: null as string | null,
  generation: 1,
  write: vi.fn(),
  get: vi.fn(),
  game: vi.fn(),
  published: vi.fn(),
  start: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/data/text-game-api", () => ({ getPublishedTextGame: h.published }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({
    read: () => h.raw,
    write: (raw: string) => {
      h.write(raw);
      h.raw = raw;
    },
  }),
}));
vi.mock("@/lib/durable-record-key", () => ({ durableRecordKey: () => "play" }));
vi.mock("./text-adventure-play-lock", async () => import("./text-adventure-play-lock.native"));
vi.mock("./api/text-adventure-api", () => ({ getTextAdventure: h.game }));
vi.mock("./api/text-adventure-session-api", () => ({
  getPlayingTextAdventureSession: h.get,
  startTextAdventureSession: h.start,
  sendTextAdventureAction: h.send,
}));
const gameId = "tg_0123456789abcdef",
  sessionId = "ts_0123456789abcdef";
const session = {
  gameId,
  sessionId,
  resumed: true,
  bgmUrl: null,
  stillUrls: [],
  startedAt: "today",
  messages: [{ id: "1", role: "assistant" as const, content: "Welcome", createdAt: "today" }],
};
const user = { id: "2", role: "user" as const, content: "Look", createdAt: "today" };
const assistant = { id: "3", role: "assistant" as const, content: "A lake", createdAt: "today" };
const workflow = () => textAdventurePlayWorkflow(gameId, { userId: "1", generation: 1 });
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.raw = null;
  h.generation = 1;
  h.get.mockResolvedValue(session);
  h.game.mockResolvedValue({ publishedVersionId: "1" });
});
it("loads without starting a new session", async () => {
  expect((await workflow().refresh(signal())).session).toEqual(session);
  expect(h.start).not.toHaveBeenCalled();
});
it("persists intent before sending and clears only a complete known success", async () => {
  h.send.mockImplementation(async (_id, _text, _locale, _account, _signal, handlers) => {
    expect(workflow().read()?.kind).toBe("action");
    handlers.onUserMessage(user);
    handlers.onAssistantDelta("A ");
    handlers.onAssistantDelta("lake");
    return { sessionId, userMessage: user, assistantMessage: assistant };
  });
  const update = vi.fn();
  expect((await workflow().send(session, "Look", "en-US", signal(), update)).messages).toEqual([
    ...session.messages,
    user,
    assistant,
  ]);
  expect(workflow().read()).toBeNull();
  expect(update).toHaveBeenCalledTimes(3);
});
it("recovers a lost action only after its acknowledged message has a following assistant response", async () => {
  h.send.mockImplementation(async (_id, _text, _locale, _account, _signal, handlers) => {
    handlers.onUserMessage(user);
    throw new Error("lost");
  });
  await expect(workflow().send(session, "Look", "en-US", signal(), vi.fn())).rejects.toThrow(
    "lost"
  );
  h.get.mockResolvedValue({ ...session, messages: [...session.messages, user] });
  expect((await workflow().refresh(signal())).pending).not.toBeNull();
  h.get.mockResolvedValue({ ...session, messages: [...session.messages, user, assistant] });
  expect((await workflow().refresh(signal())).pending).toBeNull();
  expect(h.send).toHaveBeenCalledOnce();
});
it("does not infer success from identical text without a returned message ID", async () => {
  h.send.mockRejectedValue(new Error("lost before meta"));
  await expect(workflow().send(session, "Look", "en-US", signal(), vi.fn())).rejects.toThrow();
  h.get.mockResolvedValue({ ...session, messages: [...session.messages, user, assistant] });
  expect((await workflow().refresh(signal())).pending).not.toBeNull();
  await expect(workflow().send(session, "Look", "en-US", signal(), vi.fn())).rejects.toThrow(
    "unknown result"
  );
  expect(h.send).toHaveBeenCalledOnce();
});
it("refuses stale sessions, pending story responses and failed persistence before POST", async () => {
  h.get.mockResolvedValue({ ...session, messages: [...session.messages, user] });
  await expect(workflow().send(session, "Look", "en-US", signal(), vi.fn())).rejects.toThrow(
    "changed"
  );
  const waiting = { ...session, messages: [...session.messages, user] };
  await expect(workflow().send(waiting, "Look", "en-US", signal(), vi.fn())).rejects.toThrow(
    "Wait"
  );
  h.get.mockResolvedValue(session);
  h.write.mockImplementation(() => {
    throw new Error("disk full");
  });
  await expect(workflow().send(session, "Look", "en-US", signal(), vi.fn())).rejects.toThrow(
    "disk full"
  );
  expect(h.send).not.toHaveBeenCalled();
});
it("requires published content and an unchanged previous session before restart", async () => {
  h.game.mockResolvedValue({ publishedVersionId: null });
  await expect(workflow().start(sessionId, "en-US", signal(), vi.fn())).rejects.toThrow("Publish");
  h.game.mockResolvedValue({ publishedVersionId: "1" });
  await expect(workflow().start(null, "en-US", signal(), vi.fn())).rejects.toThrow("changed");
  expect(h.start).not.toHaveBeenCalled();
});
it("recovers a new session after acknowledged metadata but never another device's session", async () => {
  const next = { ...session, sessionId: "ts_fedcba9876543210", resumed: false };
  h.start.mockImplementation(async (_id, _locale, _account, _signal, onSession) => {
    onSession({ ...next, messages: [] });
    throw new Error("lost");
  });
  await expect(workflow().start(sessionId, "en-US", signal(), vi.fn())).rejects.toThrow();
  expect((await workflow().refresh(signal())).pending).not.toBeNull();
  h.get.mockResolvedValue({ ...next, resumed: true });
  expect((await workflow().refresh(signal())).pending).toBeNull();
  expect(h.start).toHaveBeenCalledOnce();
});
it("blocks concurrent writes and preserves intent when the account changes", async () => {
  let resolve!: (value: unknown) => void;
  h.send.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = workflow().send(session, "Look", "en-US", signal(), vi.fn());
  await vi.waitFor(() => expect(h.send).toHaveBeenCalledOnce());
  await expect(workflow().send(session, "Look", "en-US", signal(), vi.fn())).rejects.toThrow(
    "already running"
  );
  h.generation = 2;
  resolve({ sessionId, userMessage: user, assistantMessage: assistant });
  await expect(pending).rejects.toThrow("account changed");
  h.generation = 1;
  expect(workflow().read()).not.toBeNull();
});
it("clears only the exact pending record the user acknowledged", async () => {
  h.send.mockRejectedValue(new Error("lost"));
  await expect(workflow().send(session, "Look", "en-US", signal(), vi.fn())).rejects.toThrow();
  await expect(workflow().clearUnknown("stale")).rejects.toThrow("changed");
  await workflow().clearUnknown(workflow().read()!.id);
  expect(workflow().read()).toBeNull();
});

it("does not report a restart as successful when Java returns the old session", async () => {
  h.start.mockImplementation(async (_id, _locale, _account, _signal, onSession) => {
    onSession({ ...session, resumed: false });
    return session;
  });
  await expect(workflow().start(sessionId, "en-US", signal(), vi.fn())).rejects.toThrow(
    "new play session"
  );
  expect((await workflow().refresh(signal())).pending).not.toBeNull();
});

it("public play uses published metadata without requesting creator access", async () => {
  h.published.mockResolvedValue({});
  h.get.mockResolvedValue(null);
  h.start.mockResolvedValue(session);
  await textAdventurePlayWorkflow(gameId, { userId: "1", generation: 1 }, "public").start(
    null,
    "en-US",
    signal(),
    vi.fn()
  );
  expect(h.published).toHaveBeenCalledWith(gameId, expect.any(AbortSignal));
  expect(h.game).not.toHaveBeenCalled();
});
it("does not start public play when publication has been withdrawn", async () => {
  h.published.mockRejectedValue(new Error("Not published"));
  await expect(
    textAdventurePlayWorkflow(gameId, { userId: "1", generation: 1 }, "public").start(
      null,
      "en-US",
      signal(),
      vi.fn()
    )
  ).rejects.toThrow("Not published");
  expect(h.start).not.toHaveBeenCalled();
  expect(workflow().read()).toBeNull();
});
