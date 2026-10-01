import { beforeEach, expect, it, vi } from "vitest";
import { loadTextAdventurePreview, sendTextAdventurePreview } from "./text-adventure-preview-api";
import type { TextGamePlaySession } from "@repo/shared/text-game";
const h = vi.hoisted(() => ({ get: vi.fn(), start: vi.fn(), send: vi.fn() }));
vi.mock("./text-adventure-session-api", () => ({
  getPlayingTextAdventureSession: h.get,
  startTextAdventureSession: h.start,
  sendTextAdventureAction: h.send,
}));
const account = { userId: "1", generation: 1 },
  signal = new AbortController().signal;
beforeEach(() => vi.resetAllMocks());
it("resumes without starting another session", async () => {
  h.get.mockResolvedValue({ sessionId: "existing" });
  expect(await loadTextAdventurePreview("game", "en-US", account, signal)).toEqual({
    sessionId: "existing",
  });
  expect(h.start).not.toHaveBeenCalled();
});
it("starts only when no session exists", async () => {
  h.get.mockResolvedValue(null);
  await loadTextAdventurePreview("game", "en-US", account, signal);
  expect(h.start).toHaveBeenCalledWith("game", "en-US", account, signal);
});
it("does not start after failed resume", async () => {
  h.get.mockRejectedValue(new Error("offline"));
  await expect(loadTextAdventurePreview("game", "en-US", account, signal)).rejects.toThrow(
    "offline"
  );
  expect(h.start).not.toHaveBeenCalled();
});
it("appends validated replies", async () => {
  h.send.mockResolvedValue({ userMessage: { id: "user" }, assistantMessage: { id: "assistant" } });
  const result = await sendTextAdventurePreview(
    { sessionId: "session", messages: [] } as unknown as TextGamePlaySession,
    " Go ",
    "en-US",
    account,
    signal
  );
  expect(h.send).toHaveBeenCalledWith("session", "Go", "en-US", account, signal);
  expect(result.messages).toEqual([{ id: "user" }, { id: "assistant" }]);
});
