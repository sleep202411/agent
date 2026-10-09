import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  chronologicalMessages,
  fetchConversation,
  fetchCrewConversation,
  fetchConversationMessages,
  markConversationRead,
  messageSchema,
  sendConversationText,
  type NativeMessage,
} from "./conversation-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const message = (id = "m", changes: Partial<NativeMessage> = {}): NativeMessage => ({
  id,
  conversationId: "chat",
  authorId: "1",
  clientKey: "key",
  type: "text",
  body: "Hello",
  payload: null,
  createdAt: "2026-09-29T00:00:00.000Z",
  ...changes,
});
const detail = {
  id: "chat",
  contextType: "service",
  contextId: "service",
  participants: [{ userId: "1", role: "buyer", lastReadMessageId: null }],
  lastMessage: message(),
  lastMessageAt: "2026-09-29T00:00:00Z",
  unreadCount: 1,
  createdAt: "2026-09-29T00:00:00Z",
};
beforeEach(() => vi.resetAllMocks());
it("loads authorized details and validates viewer/thread identity", async () => {
  vi.mocked(api.get).mockResolvedValue(detail);
  const signal = new AbortController().signal;
  expect((await fetchConversation("chat", "1", signal)).unreadCount).toBe(1);
  expect(api.get).toHaveBeenCalledWith("/conversations/chat", { service: "aurora", signal });
  await expect(fetchConversation("chat", "2", signal)).rejects.toThrow("this account");
  await expect(fetchConversation("other", "1", signal)).rejects.toThrow();
  vi.mocked(api.get).mockResolvedValue({
    ...detail,
    lastMessage: message("m", { conversationId: "other" }),
  });
  await expect(fetchConversation("chat", "1", signal)).rejects.toThrow("scope mismatch");
});
it("paginates with cancellation and rejects cross-thread history", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [message()], nextCursor: "m" });
  const signal = new AbortController().signal;
  expect((await fetchConversationMessages("chat", "previous", signal)).nextCursor).toBe("m");
  expect(api.get).toHaveBeenCalledWith("/conversations/chat/messages", {
    service: "aurora",
    signal,
    params: { limit: 50, cursor: "previous" },
  });
  await expect(fetchConversationMessages("a/b", null, signal)).rejects.toThrow("scope mismatch");
  expect(vi.mocked(api.get).mock.calls.at(-1)?.[0]).toBe("/conversations/a%2Fb/messages");
});
it("keeps authoritative ordering and freshest duplicates without Date sorting", () => {
  const newest = message("a", { body: "updated" });
  const middle = message("z");
  const oldest = message("x");
  const pages = [{ items: [newest, middle] }, { items: [message("z", { body: "stale" }), oldest] }];
  expect(chronologicalMessages(pages)).toEqual([oldest, middle, newest]);
  expect(pages[0].items).toEqual([newest, middle]);
});
it("sends text with the exact retry key and structured references", async () => {
  vi.mocked(api.post).mockResolvedValue(message());
  const mentions = [{ userId: "2", label: "Alex" }];
  const tasks = [{ taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "Shot 1" }];
  await sendConversationText("chat", { body: " Hello ", clientKey: "key", mentions, tasks });
  expect(api.post).toHaveBeenCalledWith("/conversations/chat/messages", {
    service: "aurora",
    data: { body: "Hello", clientKey: "key", mentions, tasks },
  });
});
it.each([
  { body: " " },
  { body: "x".repeat(4001) },
  { clientKey: "" },
  { mentions: [{ userId: "2", label: "@Alex" }] },
  { tasks: [{ taskId: "not-a-uuid", label: "Shot" }] },
])("rejects invalid sends before making a request", async (invalid) => {
  await expect(
    sendConversationText("chat", { body: "Hello", clientKey: "key", ...invalid })
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects mismatched acknowledgements and propagates errors without mutation retry", async () => {
  vi.mocked(api.post).mockResolvedValue(message("m", { clientKey: "other" }));
  await expect(sendConversationText("chat", { body: "Hello", clientKey: "key" })).rejects.toThrow(
    "acknowledgement"
  );
  vi.mocked(api.post).mockClear().mockRejectedValue(new Error("Removed from crew"));
  await expect(sendConversationText("chat", { body: "Hello", clientKey: "key" })).rejects.toThrow(
    "Removed from crew"
  );
  expect(api.post).toHaveBeenCalledOnce();
});
it("uses the visible-message read cursor and accepts a newer server cursor", async () => {
  vi.mocked(api.post).mockResolvedValue({ lastReadMessageId: "newer" });
  const signal = new AbortController().signal;
  expect(await markConversationRead("chat", "visible", signal)).toEqual({
    lastReadMessageId: "newer",
  });
  expect(api.post).toHaveBeenCalledWith("/conversations/chat/read", {
    service: "aurora",
    signal,
    data: { lastReadMessageId: "visible" },
  });
});
it("preserves attachments, proposals and system payloads without treating storage as a URL", () => {
  const attachment = {
    assetNodeId: "asset",
    mediaAssetId: "media",
    name: "Cut.mp4",
    mediaKind: "video" as const,
    contentType: "video/mp4",
    sizeBytes: 10,
  };
  const attached = message("m", {
    type: "file",
    payload: {
      kind: "attachments",
      attachments: [attachment],
      tasks: [{ taskId: "task", crewId: "crew", number: 1, label: "Cut" }],
    },
  });
  expect(messageSchema.parse(attached)).toEqual(attached);
  const proposal = message("p", {
    type: "proposal",
    payload: {
      kind: "proposal",
      proposal: {
        status: "open",
        packageTier: "basic",
        price: 12.5,
        currency: "USD",
        deliveryDays: 3,
        revisions: -1,
        scope: ["Cut"],
        note: "Offer",
      },
    },
  });
  expect(messageSchema.parse(proposal)).toEqual(proposal);
  const system = message("s", {
    type: "system",
    authorId: null,
    payload: { kind: "system", system: { kind: "future.event", params: { count: 1 } } },
  });
  expect(messageSchema.parse(system)).toEqual(system);
  expect(messageSchema.safeParse({ ...attached, type: "proposal" }).success).toBe(false);
});

it.each(["team", "community"] as const)(
  "resolves the authorized %s Crew channel",
  async (channel) => {
    const row = { ...detail, contextType: "crew", contextId: "shortCrew", crewChannel: channel };
    vi.mocked(api.get).mockResolvedValue(row);
    expect(
      await fetchCrewConversation("shortCrew", channel, "1", new AbortController().signal)
    ).toEqual(row);
    expect(api.get).toHaveBeenCalledWith(
      `/crews/shortCrew/${channel === "team" ? "conversation" : "community-conversation"}`,
      expect.objectContaining({ service: "aurora", retry: false })
    );
  }
);
it.each([
  { contextId: "other" },
  { contextType: "service" },
  { crewChannel: "community" },
  { participants: [] },
  { lastMessage: message("foreign", { conversationId: "another" }) },
])("rejects a mismatched Crew channel response", async (changes) => {
  vi.mocked(api.get).mockResolvedValue({
    ...detail,
    contextType: "crew",
    contextId: "shortCrew",
    crewChannel: "team",
    ...changes,
  });
  await expect(
    fetchCrewConversation("shortCrew", "team", "1", new AbortController().signal)
  ).rejects.toThrow();
});
it("does not resolve an aborted Crew channel", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchCrewConversation("crew", "team", "1", c.signal)).rejects.toThrow("aborted");
  expect(api.get).not.toHaveBeenCalled();
});
