import { z } from "zod";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { serviceDraftSchema } from "./service-create-api";
export const pendingServiceDraft = z.object({
  data: serviceDraftSchema,
  clientKey: z.string().min(8).max(64),
});
export function serviceCreationPending(userId: string, generation: number) {
  return pendingRequest(
    pendingServiceDraft,
    generation,
    durableRecord("service-create", userId, "draft")
  );
}
