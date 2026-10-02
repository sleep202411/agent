import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { deliveryTemplate } from "./task-delivery-api";
const category = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  definition: deliveryTemplate.shape.definition,
});
export type DeliveryCategory = z.infer<typeof category>;
export async function fetchDeliveryCatalog(crewId: string, signal: AbortSignal, cursor?: string) {
  z.string().min(1).max(64).parse(crewId);
  if (cursor) z.string().uuid().parse(cursor);
  return z.object({ items: z.array(category), nextCursor: z.string().uuid().nullable() }).parse(
    await api.get(`/crews/${encodeURIComponent(crewId)}/delivery-catalog`, {
      service: "aurora",
      signal,
      params: { limit: 50, ...(cursor ? { cursor } : {}) },
    })
  );
}
export async function setDeliveryTemplate(
  taskId: string,
  expectedVersion: number,
  selected: { id: string; version: number } | null,
  generation: number,
  signal: AbortSignal
) {
  z.string().uuid().parse(taskId);
  const data = z
    .object({
      expectedVersion: z.number().int().nonnegative(),
      category: category.pick({ id: true, version: true }).nullable(),
    })
    .parse({ expectedVersion, category: selected });
  if (signal.aborted || generation !== getAuthGeneration())
    throw Error("Session changed. Reopen the task.");
  const result = deliveryTemplate.nullable().parse(
    await api.post(`/crew-tasks/${taskId}/delivery-template`, {
      service: "aurora",
      signal,
      data,
      retry: false,
    })
  );
  if (signal.aborted || generation !== getAuthGeneration())
    throw Error("Session changed. Reopen the task.");
  if (
    selected
      ? result?.categoryId !== selected.id || result?.version !== selected.version
      : result !== null
  )
    throw Error("Delivery template receipt mismatch. Refresh the task before continuing.");
  return result;
}
