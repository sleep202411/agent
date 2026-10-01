import { z } from "zod";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const schema = z.object({
  clientKey: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(4000),
});
export function inquiryOutbox(
  serviceId: string,
  userId: string,
  generation: number,
  store: DurableRecord = durableRecord("service-inquiry", userId, serviceId)
) {
  return pendingRequest(schema, generation, store);
}
