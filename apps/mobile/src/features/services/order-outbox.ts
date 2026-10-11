import { z } from "zod";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const schema = z
  .object({
    clientKey: z.string().min(8).max(64),
    payload: z.object({
      serviceId: z.string().min(1).max(64),
      expectedServiceVersion: z.number().int().nonnegative(),
      packageTier: z.enum(["basic", "standard", "premium"]),
      answers: z
        .array(z.object({ questionId: z.string().min(1), answer: z.string().max(4000) }))
        .max(20),
      note: z.string().max(2000).optional(),
      idempotencyKey: z.string().min(8).max(64),
    }),
    offer: z.object({
      packages: z.array(
        z.object({
          id: z.string(),
          tier: z.string(),
          title: z.string(),
          description: z.string(),
          price: z.number().nonnegative(),
          currency: z.string(),
          deliveryDays: z.number(),
          revisions: z.number(),
          scope: z.array(z.string()),
        })
      ),
      requirementQuestions: z.array(
        z.object({
          id: z.string(),
          prompt: z.string(),
          helpText: z.string().optional(),
          required: z.boolean(),
        })
      ),
    }),
  })
  .refine(
    (value) => value.clientKey === value.payload.idempotencyKey,
    "Order request keys must match"
  );
export function orderOutbox(
  serviceId: string,
  userId: string,
  generation: number,
  store: DurableRecord = durableRecord("service-order", userId, serviceId)
) {
  const scoped = schema.refine(
    (value) => value.payload.serviceId === serviceId,
    "Order service must match"
  );
  const queue = pendingRequest(scoped, generation, store);
  return {
    ...queue,
    save(value: unknown) {
      const next = scoped.parse(value);
      queue.save(next);
      return next;
    },
  };
}
