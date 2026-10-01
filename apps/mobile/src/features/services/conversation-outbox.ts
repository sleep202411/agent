import { z } from "zod";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { getAuthGeneration } from "@/auth/auth-store";
import { attachmentMessageSchema } from "./conversation-attachments";
import { textMessageInputSchema } from "./conversation-api";
const intentSchema = z.union([
  attachmentMessageSchema,
  textMessageInputSchema.extend({ attachments: z.array(z.never()).length(0).optional() }),
]);
export type ConversationIntent = z.input<typeof intentSchema>;
const recordSchema = z.object({ version: z.literal(1), intent: intentSchema.nullable() });
export function conversationOutbox(
  id: string,
  userId: string,
  generation: number,
  storage: DurableRecord = durableRecord("conversation-send", userId, id)
) {
  const current = () => {
    if (generation !== getAuthGeneration()) throw new Error("Message session expired.");
  };
  const read = () => {
    current();
    const raw = storage.read();
    return raw === null ? null : recordSchema.parse(JSON.parse(raw)).intent;
  };
  return {
    read,
    save: (intent: ConversationIntent) => {
      current();
      const next = intentSchema.parse(intent);
      const previous = read();
      if (previous && JSON.stringify(previous) !== JSON.stringify(next))
        throw new Error("Another message is pending. Reopen this conversation before sending.");
      storage.write(JSON.stringify({ version: 1, intent: next }));
    },
    clear: (clientKey: string) => {
      current();
      const previous = read();
      if (previous && previous.clientKey !== clientKey)
        throw new Error("Another message is pending. Reopen this conversation before sending.");
      storage.write(JSON.stringify({ version: 1, intent: null }));
    },
  };
}
