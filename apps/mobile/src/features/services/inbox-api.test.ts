import { expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchInbox } from "./inbox-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const item = {
  id: "chat",
  contextType: "crew",
  contextId: "crew",
  counterpartyId: "crew",
  counterpartyRole: "member",
  crewName: "Hunter",
  crewChannel: "community",
  lastMessagePreview: "Hello",
  lastMessageType: "text",
  lastMessageAt: "2026-09-29T00:00:00Z",
  unreadCount: 2,
};
it("uses the inbox filter/cursor contract and preserves Crew identity/channel/unread data", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [item], nextCursor: "next" });
  const signal = new AbortController().signal;
  expect(await fetchInbox("crew", "cursor", signal)).toEqual({ items: [item], nextCursor: "next" });
  expect(api.get).toHaveBeenCalledWith("/conversations", {
    service: "aurora",
    signal,
    params: { limit: 24, contextType: "crew", cursor: "cursor" },
  });
});
it.each([
  {},
  { items: [{ ...item, unreadCount: -1 }], nextCursor: null },
  { items: [{ ...item, contextType: "unknown" }], nextCursor: null },
])("rejects malformed inbox data instead of showing a false empty state", async (data) => {
  vi.mocked(api.get).mockResolvedValue(data);
  await expect(fetchInbox("", null, new AbortController().signal)).rejects.toThrow();
});
