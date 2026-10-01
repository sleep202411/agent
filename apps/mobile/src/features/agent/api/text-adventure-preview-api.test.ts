import { beforeEach, expect, it, vi } from "vitest";
import { loadTextAdventurePreview, sendTextAdventurePreview } from "./text-adventure-preview-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const session = { userId: "123", generation: 1 },
  gameId = "tg_0123456789abcdef",
  sessionId = "ts_0123456789abcdef";
const signal = () => new AbortController().signal;
function response(meta: object, done = { sessionId, messageId: "42", content: "Story" }) {
  const bytes = new TextEncoder().encode(
    `event: meta\ndata: ${JSON.stringify(meta)}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`
  ).buffer;
  return { bytes, contentType: "text/event-stream" };
}
const preview = {
  gameId,
  sessionId,
  resumed: true,
  messages: [],
  startedAt: "2026-10-01",
  bgmUrl: null,
  stillUrls: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(null);
  h.post.mockResolvedValue(response({ ...preview, resumed: false }));
});
it("resumes an existing session without creating a second one", async () => {
  h.get.mockResolvedValue(preview);
  expect(await loadTextAdventurePreview(gameId, "en-US", session, signal())).toEqual(preview);
  expect(h.post).not.toHaveBeenCalled();
});
it("parses a complete creator preview with locale and no write retry", async () => {
  const value = await loadTextAdventurePreview(gameId, "zh-CN", session, signal());
  expect(value.messages[0]?.content).toBe("Story");
  expect(h.post).toHaveBeenCalledWith(
    `/api/player/text-game/${gameId}/start/stream`,
    expect.objectContaining({ retry: false, data: { locale: "zh-CN" } })
  );
});
it("rejects a stream belonging to a different game", async () => {
  h.post.mockResolvedValue(response({ ...preview, gameId: "tg_1111111111111111", resumed: false }));
  await expect(loadTextAdventurePreview(gameId, "en-US", session, signal())).rejects.toThrow(
    "identity mismatch"
  );
});
it("rejects incomplete responses without fabricating assistant output", async () => {
  h.post.mockResolvedValue({
    contentType: "text/event-stream",
    bytes: new TextEncoder().encode("event: meta\ndata: {}\n\n").buffer,
  });
  await expect(loadTextAdventurePreview(gameId, "en-US", session, signal())).rejects.toThrow(
    "interrupted"
  );
});
it("checks account generation after the request completes", async () => {
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return response({ ...preview, resumed: false });
  });
  await expect(loadTextAdventurePreview(gameId, "en-US", session, signal())).rejects.toThrow(
    "session changed"
  );
});
it("appends the server's user and assistant turns to the matching session", async () => {
  h.post.mockResolvedValue(
    response({
      sessionId,
      userMessage: { id: "41", role: "user", content: "Open door", createdAt: "2026-10-01" },
    })
  );
  const next = await sendTextAdventurePreview(preview, "Open door", "en-US", session, signal());
  expect(next.messages.map((item) => item.id)).toEqual(["41", "42"]);
});
