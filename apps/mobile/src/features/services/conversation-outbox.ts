import { z } from "zod";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { attachmentMessageSchema } from "./conversation-attachments";
import { textMessageInputSchema } from "./conversation-api";
const intentSchema = z.union([
  attachmentMessageSchema,
  textMessageInputSchema.extend({ attachments: z.array(z.never()).length(0).optional() }),
]);
export type ConversationIntent = z.input<typeof intentSchema>;
export function conversationOutbox(
  id: string,
  userId: string,
  generation: number,
  storage: DurableRecord = durableRecord("conversation-send", userId, id)
) {
  return pendingRequest(intentSchema, generation, storage);
}
