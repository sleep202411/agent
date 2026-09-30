import { z } from "zod";
import { SERVICE_TIERS } from "@repo/shared/creator-service";
import { ALL_CURRENCIES } from "@repo/shared/crew";
import { api } from "@/lib/api-client";
import { messageSchema, type NativeConversation, type NativeMessage } from "./conversation-api";
import { orderSchema } from "./order-detail-api";

export const proposalInputSchema = z.object({
  clientKey: z.string().trim().min(1).max(64),
  note: z.string().trim().max(2000).default(""),
  packageTier: z.enum(SERVICE_TIERS),
  price: z.number().finite().min(0).max(100_000_000),
  currency: z.enum(ALL_CURRENCIES),
  deliveryDays: z.number().int().min(1).max(365),
  revisions: z.number().int().min(-1).max(200).default(0),
  scope: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
});
const encode = (id: string) => encodeURIComponent(z.string().min(1).max(64).parse(id));
export function canSendProposal(conversation: NativeConversation, userId: string) {
  return (
    conversation.contextType === "service" &&
    conversation.participants.some((p) => p.userId === userId && p.role === "creator")
  );
}
export function canDecideProposal(
  conversation: NativeConversation,
  message: NativeMessage,
  userId: string
) {
  return (
    conversation.contextType === "service" &&
    message.conversationId === conversation.id &&
    message.type === "proposal" &&
    message.payload?.kind === "proposal" &&
    message.payload.proposal.status === "open" &&
    conversation.participants.some((p) => p.userId === userId && p.role === "buyer")
  );
}
export async function sendProposal(
  conversation: NativeConversation,
  userId: string,
  input: z.input<typeof proposalInputSchema>
) {
  if (!canSendProposal(conversation, userId)) throw new Error("Proposal is not available");
  const data = proposalInputSchema.parse(input);
  const result = messageSchema.parse(
    await api.post(`/conversations/${encode(conversation.id)}/proposals`, {
      service: "aurora",
      data,
    })
  );
  // A retry can return the original proposal after it has been accepted/declined.
  if (
    result.conversationId !== conversation.id ||
    result.type !== "proposal" ||
    result.authorId !== userId ||
    result.clientKey !== data.clientKey
  )
    throw new Error("Proposal acknowledgement mismatch");
  return result;
}
export async function declineProposal(
  conversation: NativeConversation,
  message: NativeMessage,
  userId: string
) {
  if (!canDecideProposal(conversation, message, userId))
    throw new Error("Proposal decision is not available");
  const result = messageSchema.parse(
    await api.post(
      `/conversations/${encode(conversation.id)}/proposals/${encode(message.id)}/decline`,
      { service: "aurora" }
    )
  );
  if (
    result.id !== message.id ||
    result.conversationId !== conversation.id ||
    result.payload?.kind !== "proposal" ||
    result.payload.proposal.status !== "declined"
  )
    throw new Error("Proposal acknowledgement mismatch");
  return result;
}
export async function acceptProposal(
  conversation: NativeConversation,
  message: NativeMessage,
  userId: string
) {
  if (!canDecideProposal(conversation, message, userId))
    throw new Error("Proposal decision is not available");
  // This materializes the existing offer as an order. No wallet/payment call.
  const result = orderSchema.parse(
    await api.post(`/orders/from-proposal/${encode(conversation.id)}/${encode(message.id)}`, {
      service: "aurora",
    })
  );
  if (
    result.conversationId !== conversation.id ||
    result.buyerId !== userId ||
    result.serviceId !== conversation.contextId ||
    !conversation.participants.some((p) => p.userId === result.creatorId && p.role === "creator")
  )
    throw new Error("Proposal order scope mismatch");
  return result;
}
