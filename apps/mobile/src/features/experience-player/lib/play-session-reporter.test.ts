import { beforeEach, expect, it, vi } from "vitest";
import { createPlaySessionReporter } from "./play-session-reporter";
const h = vi.hoisted(() => ({ generation: 1, post: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
beforeEach(() => {
  h.generation = 1;
  h.post.mockReset();
});
it("uses the official Studio session contract and propagates failed completion saves", async () => {
  const reporter = createPlaySessionReporter(1);
  h.post.mockResolvedValueOnce({ sessionId: "session-1" });
  const payload = {
    gameId: "film",
    buildId: "build",
    contentVersion: "1",
    experienceType: "film" as const,
  };
  expect(await reporter.onStart(payload)).toEqual({ sessionId: "session-1" });
  expect(h.post).toHaveBeenLastCalledWith("/api/player/play/sessions/start", {
    service: "studio",
    data: payload,
  });
  h.post.mockRejectedValueOnce(new Error("Save unavailable"));
  await expect(
    reporter.onComplete("session-1", { endingId: "ending", currentNode: "scene" })
  ).rejects.toThrow("Save unavailable");
  h.post.mockResolvedValueOnce({});
  await reporter.onComplete("session-1", { endingId: "ending", currentNode: "scene" });
  expect(h.post).toHaveBeenLastCalledWith("/api/player/play/sessions/complete", {
    service: "studio",
    data: { sessionId: "session-1", endingId: "ending", currentNode: "scene" },
  });
});
it("does not send a previous viewer's report under the replacement account", async () => {
  const reporter = createPlaySessionReporter(1);
  h.generation = 2;
  await expect(
    reporter.onComplete("old", { endingId: "ending", currentNode: "scene" })
  ).rejects.toThrow("Playback account changed");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects late start results after an account switch", async () => {
  let finish!: (value: unknown) => void;
  h.post.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const pending = createPlaySessionReporter(1).onStart({
    gameId: "film",
    buildId: "build",
    contentVersion: "1",
    experienceType: "film",
  });
  h.generation = 2;
  finish({ sessionId: "old" });
  await expect(pending).rejects.toThrow("Playback account changed");
});
it("rejects malformed session identity", async () => {
  h.post.mockResolvedValue({ sessionId: "" });
  await expect(
    createPlaySessionReporter(1).onStart({
      gameId: "film",
      buildId: "build",
      contentVersion: "1",
      experienceType: "film",
    })
  ).rejects.toThrow("Invalid play session");
});
