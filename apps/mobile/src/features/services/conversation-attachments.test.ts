import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { sendConversationAttachments } from "./conversation-attachments";
import type { NativeConversation } from "./conversation-api";
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const conversation: NativeConversation = {
  id: "crew/chat",
  contextId: "crew",
  contextType: "crew",
  crewChannel: "team",
  participants: [{ userId: "member", role: "member", lastReadMessageId: null }],
  lastMessage: null,
  lastMessageAt: "now",
  createdAt: "now",
  unreadCount: 0,
};
const input = {
  clientKey: "stable",
  attachments: [{ source: "upload" as const, mediaAssetId: uuid, name: "movie.mp4" }],
};
const result = {
  id: "message",
  conversationId: conversation.id,
  authorId: "member",
  clientKey: "stable",
  type: "file",
  body: "",
  createdAt: "now",
  payload: {
    kind: "attachments",
    attachments: [
      {
        assetNodeId: uuid,
        mediaAssetId: uuid,
        name: "movie.mp4",
        mediaKind: "video",
        contentType: "video/mp4",
        sizeBytes: 1024,
      },
    ],
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.post).mockResolvedValue(result);
});
it("sends confirmed media IDs with stable keys and no storage paths", async () => {
  await sendConversationAttachments(conversation, "member", {
    ...input,
    attachments: [
      { ...input.attachments[0], storageKey: "must-not-send" } as (typeof input.attachments)[0],
    ],
  });
  expect(api.post).toHaveBeenCalledWith("/conversations/crew%2Fchat/attachments", {
    service: "aurora",
    data: { ...input, body: "", mentions: [], tasks: [] },
  });
});
it("references existing Crew assets without recreating them", async () => {
  await sendConversationAttachments(conversation, "member", {
    ...input,
    attachments: [{ source: "asset", assetNodeId: uuid }],
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.post).mock.calls[0][1]?.data).toMatchObject({
    attachments: [{ source: "asset", assetNodeId: uuid }],
  });
});
it.each(["service", "order"] as const)(
  "blocks unsupported %s attachments before writing",
  async (contextType) => {
    await expect(
      sendConversationAttachments({ ...conversation, contextType }, "member", input)
    ).rejects.toThrow("not available");
    expect(api.post).not.toHaveBeenCalled();
  }
);
it("denies community and nonparticipant sends", async () => {
  await expect(
    sendConversationAttachments({ ...conversation, crewChannel: "community" }, "member", input)
  ).rejects.toThrow();
  await expect(sendConversationAttachments(conversation, "outsider", input)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(
  [
    [],
    [input.attachments[0], input.attachments[0]],
    Array.from({ length: 11 }, () => input.attachments[0]),
    [{ source: "upload" as const, mediaAssetId: uuid, name: "../file" }],
    [{ source: "asset" as const, assetNodeId: "invalid" }],
  ].map((attachments) => ({ attachments }))
)("rejects invalid attachment lists", async ({ attachments }) => {
  await expect(
    sendConversationAttachments(conversation, "member", { ...input, attachments })
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { conversationId: "other" },
  { authorId: "other" },
  { clientKey: "other" },
  { type: "text", payload: null },
])("rejects mismatched acknowledgements", async (wrong) => {
  vi.mocked(api.post).mockResolvedValue({ ...result, ...wrong });
  await expect(sendConversationAttachments(conversation, "member", input)).rejects.toThrow(
    "acknowledgement"
  );
});
