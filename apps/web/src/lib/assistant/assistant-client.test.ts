import { afterEach, expect, it, vi } from "vitest";
import {
  clearConversation,
  fetchConversationHistory,
  fetchMessagesByIds,
} from "./assistant-client";
afterEach(() => vi.unstubAllGlobals());
it("rejects failed message reads instead of returning empty history", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
  await expect(fetchMessagesByIds("p", ["m"])).rejects.toThrow("503");
});
it("rejects failed clears so existing local history is preserved", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
  await expect(clearConversation("p")).rejects.toThrow("403");
});
it("preserves successful history and clear requests", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ conversationId: "p", messageIds: ["m"] }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: "m" }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
  );
  await expect(fetchConversationHistory("p")).resolves.toEqual({
    conversationId: "p",
    messages: [{ id: "m" }],
  });
  await expect(clearConversation("p")).resolves.toBeUndefined();
});
