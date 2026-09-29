import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { acceptProposal, declineProposal, sendProposal } from "./conversation-proposals";
import type { NativeConversation, NativeMessage } from "./conversation-api";
import { order } from "./order-detail-fixture.test-helper";
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
const conversation: NativeConversation = {
  id: "chat/a",
  contextId: "service",
  contextType: "service",
  participants: ["buyer", "creator"].map((role) => ({
    userId: role,
    role: role as "buyer" | "creator",
    lastReadMessageId: null,
  })),
  lastMessage: null,
  lastMessageAt: "now",
  createdAt: "now",
  unreadCount: 0,
};
const input = {
  clientKey: "retry",
  packageTier: "basic" as const,
  price: 12.5,
  currency: "USD" as const,
  deliveryDays: 3,
  revisions: -1,
  scope: [" Edit "],
  note: " Offer ",
};
const message: NativeMessage = {
  id: "offer/a",
  conversationId: conversation.id,
  authorId: "creator",
  clientKey: "retry",
  type: "proposal",
  body: "Offer",
  createdAt: "now",
  payload: { kind: "proposal", proposal: { ...input, status: "open" } },
};
const accepted = {
  ...order,
  conversationId: conversation.id,
  serviceId: "service",
  status: "in_progress",
};
beforeEach(() => vi.resetAllMocks());
it("sends display-unit terms and stable retry keys, allowing an already-decided receipt", async () => {
  vi.mocked(api.post).mockResolvedValue({
    ...message,
    payload: { kind: "proposal", proposal: { ...input, status: "accepted", orderId: "order" } },
  });
  await sendProposal(conversation, "creator", input);
  expect(api.post).toHaveBeenCalledWith("/conversations/chat%2Fa/proposals", {
    service: "aurora",
    data: { ...input, note: "Offer", scope: ["Edit"] },
  });
});
it.each([
  { price: -1 },
  { price: Infinity },
  { deliveryDays: 0 },
  { revisions: -2 },
  { scope: [""] },
  { clientKey: "" },
])("rejects invalid terms before writing: %j", async (invalid) => {
  await expect(sendProposal(conversation, "creator", { ...input, ...invalid })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("blocks buyer sends, outsider decisions, closed proposals and foreign threads", async () => {
  await expect(sendProposal(conversation, "buyer", input)).rejects.toThrow();
  await expect(
    sendProposal({ ...conversation, contextType: "order" }, "creator", input)
  ).rejects.toThrow();
  for (const user of ["creator", "outsider"]) {
    await expect(acceptProposal(conversation, message, user)).rejects.toThrow();
    await expect(declineProposal(conversation, message, user)).rejects.toThrow();
  }
  await expect(
    acceptProposal(conversation, { ...message, conversationId: "other" }, "buyer")
  ).rejects.toThrow();
  await expect(
    acceptProposal(
      conversation,
      { ...message, payload: { kind: "proposal", proposal: { ...input, status: "cancelled" } } },
      "buyer"
    )
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("accepts through the existing order endpoint without client-supplied financial data", async () => {
  vi.mocked(api.post).mockResolvedValue(accepted);
  expect((await acceptProposal(conversation, message, "buyer")).status).toBe("in_progress");
  expect(api.post).toHaveBeenCalledWith("/orders/from-proposal/chat%2Fa/offer%2Fa", {
    service: "aurora",
  });
});
it.each(["buyerId", "creatorId", "conversationId", "serviceId"])(
  "rejects a foreign order %s",
  async (field) => {
    vi.mocked(api.post).mockResolvedValue({ ...accepted, [field]: "other" });
    await expect(acceptProposal(conversation, message, "buyer")).rejects.toThrow("scope mismatch");
  }
);
it("requires a matching declined receipt and preserves backend errors", async () => {
  const declined = {
    ...message,
    payload: { kind: "proposal", proposal: { ...input, status: "declined" } },
  };
  vi.mocked(api.post).mockResolvedValue(declined);
  await expect(declineProposal(conversation, message, "buyer")).resolves.toMatchObject({
    id: message.id,
  });
  expect(api.post).toHaveBeenCalledWith("/conversations/chat%2Fa/proposals/offer%2Fa/decline", {
    service: "aurora",
  });
  vi.mocked(api.post).mockResolvedValue(message);
  await expect(declineProposal(conversation, message, "buyer")).rejects.toThrow("acknowledgement");
  const error = new Error("Proposal is already accepted");
  vi.mocked(api.post).mockRejectedValue(error);
  await expect(acceptProposal(conversation, message, "buyer")).rejects.toBe(error);
});
it.each([{ clientKey: "other" }, { authorId: "other" }, { conversationId: "other" }])(
  "rejects mismatched send acknowledgements: %j",
  async (wrong) => {
    vi.mocked(api.post).mockResolvedValue({ ...message, ...wrong });
    await expect(sendProposal(conversation, "creator", input)).rejects.toThrow("acknowledgement");
  }
);
