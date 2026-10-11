import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { proposalInputSchema } from "./conversation-proposals";
export function proposalOutbox(
  id: string,
  userId: string,
  generation: number,
  storage: DurableRecord = durableRecord("conversation-proposal", userId, id)
) {
  return pendingRequest(proposalInputSchema, generation, storage);
}
