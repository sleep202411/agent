import { CREATOR_SERVICE_STATUSES } from "@repo/shared/creator-service";
import { z } from "zod";
import { api } from "@/lib/api-client";
export type ServiceFilter = "" | (typeof CREATOR_SERVICE_STATUSES)[number];
const card = z.object({
  id: z.string().min(1),
  creatorId: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  category: z.string().min(1),
  startingPrice: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  startingDeliveryDays: z.number().int().nonnegative(),
  packageCount: z.number().int().nonnegative(),
});
const page = z.object({ items: z.array(card), nextCursor: z.string().min(1).nullable() });
export type OwnedService = z.infer<typeof card>;
export async function fetchOwnedServices(
  creatorId: string,
  status: ServiceFilter,
  cursor: string | null,
  signal: AbortSignal
) {
  if (!creatorId) throw new Error("Sign in to manage services");
  const result = page.parse(
    await api.get("/creator-services", {
      service: "aurora",
      signal,
      params: {
        creatorId,
        limit: 24,
        ...(status ? { status } : {}),
        ...(cursor ? { cursor } : {}),
      },
    })
  );
  if (result.items.some((item) => item.creatorId !== creatorId))
    throw new Error("Service owner mismatch");
  return result;
}
export type ServiceAction = "publish" | "pause" | "resume" | "archive";
export function serviceActions(status: string): ServiceAction[] {
  switch (status) {
    case "draft":
      return ["publish", "archive"];
    case "listed":
      return ["pause", "archive"];
    case "paused":
      return ["resume", "archive"];
    default:
      return [];
  }
}
export async function changeServiceStatus(id: string, action: ServiceAction) {
  const path = `/creator-services/${encodeURIComponent(id)}`;
  if (action === "archive") await api.delete(path, { service: "aurora" });
  else await api.post(`${path}/${action}`, { service: "aurora" });
}
