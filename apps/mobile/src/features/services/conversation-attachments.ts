import { z } from "zod";
import { api } from "@/lib/api-client";
import { messageSchema, textMessageInputSchema, type NativeConversation } from "./conversation-api";

const attachment = z.discriminatedUnion("source", [
  z.object({ source: z.literal("asset"), assetNodeId: z.string().uuid() }),
  z.object({
    source: z.literal("upload"),
    mediaAssetId: z.string().uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine((name) => name !== "." && name !== ".." && !name.includes("/")),
  }),
]);
export const attachmentMessageSchema = textMessageInputSchema.extend({
  body: z.string().trim().max(4000).default(""),
  attachments: z
    .array(attachment)
    .min(1)
    .max(10)
    .refine((items) => {
      const keys = items.map((item) =>
        item.source === "asset" ? `asset:${item.assetNodeId}` : `upload:${item.mediaAssetId}`
      );
      return new Set(keys).size === keys.length;
    }, "The same attachment cannot be sent twice"),
});
export function canAttachCrewFiles(conversation: NativeConversation, userId: string) {
  return (
    conversation.contextType === "crew" &&
    conversation.crewChannel !== "community" &&
    conversation.participants.some((p) => p.userId === userId)
  );
}
export async function sendConversationAttachments(
  conversation: NativeConversation,
  userId: string,
  input: z.input<typeof attachmentMessageSchema>
) {
  if (!canAttachCrewFiles(conversation, userId))
    throw new Error("Crew attachments are not available");
  const data = attachmentMessageSchema.parse(input);
  const result = messageSchema.parse(
    await api.post(`/conversations/${encodeURIComponent(conversation.id)}/attachments`, {
      service: "aurora",
      data,
    })
  );
  // Asset nodes are created by the server atomically with the message. Never
  // create a visible Crew asset separately or submit a storage URL/key here.
  if (
    result.conversationId !== conversation.id ||
    result.authorId !== userId ||
    result.clientKey !== data.clientKey ||
    result.payload?.kind !== "attachments"
  )
    throw new Error("Attachment acknowledgement mismatch");
  return result;
}
