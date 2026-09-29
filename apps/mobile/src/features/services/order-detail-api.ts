import { z } from "zod";
import { ORDER_STATUSES, canTransition, type OrderAction } from "@repo/shared/order";
import { api } from "@/lib/api-client";
const id = z.string().min(1);
const schema = z.object({
  id,
  buyerId: id,
  creatorId: id,
  serviceId: id,
  conversationId: id,
  status: z.enum(ORDER_STATUSES),
  version: z.number().int().nonnegative(),
  packageSnapshot: z.object({
    packageId: id,
    tier: z.enum(["basic", "standard", "premium"]),
    title: z.string(),
    description: z.string(),
    price: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    deliveryDays: z.number().int().nonnegative(),
    revisions: z.number().int().min(-1),
    scope: z.array(z.string()),
  }),
  questionnaire: z.array(
    z.object({ prompt: z.string(), answer: z.string(), required: z.boolean() })
  ),
  bindings: z.object({
    ipId: id.nullish(),
    episodeId: id.nullish(),
    crewId: id.nullish(),
    crewPositionId: id.nullish(),
  }),
  createdAt: z.string(),
  acceptedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelInfo: z.object({ by: z.enum(["buyer", "creator"]), reason: z.string() }).nullable(),
});
export type NativeOrder = z.infer<typeof schema>;
export const ACTIONS = [
  "accept",
  "decline",
  "deliver",
  "accept_delivery",
  "request_revision",
  "cancel",
] as const;
export function orderActions(order: NativeOrder, userId: string): OrderAction[] {
  const creator = order.creatorId === userId,
    buyer = order.buyerId === userId;
  if (!creator && !buyer) return [];
  return ACTIONS.filter(
    (action) =>
      canTransition(order.status, action) &&
      (action === "cancel" || (["accept", "decline", "deliver"].includes(action) ? creator : buyer))
  );
}
export function reasonLimit(action: OrderAction) {
  return action === "request_revision"
    ? 2000
    : action === "cancel" || action === "decline"
      ? 500
      : 0;
}
function parseOrder(value: unknown, orderId: string) {
  const order = schema.parse(value);
  if (order.id !== orderId) throw new Error("Unexpected order response");
  return order;
}
export async function fetchOrder(orderId: string, signal: AbortSignal) {
  return parseOrder(
    await api.get(`/orders/${encodeURIComponent(orderId)}`, { service: "aurora", signal }),
    orderId
  );
}
export async function transitionOrder(
  order: NativeOrder,
  userId: string,
  action: OrderAction,
  reason: string
) {
  if (!orderActions(order, userId).includes(action))
    throw new Error("Order action is not available");
  const limit = reasonLimit(action),
    trimmed = reason.trim();
  if (limit && (!trimmed || trimmed.length > limit)) throw new Error("Provide a valid reason");
  const path = action.replaceAll("_", "-");
  return parseOrder(
    await api.post(`/orders/${encodeURIComponent(order.id)}/${path}`, {
      service: "aurora",
      ...(limit ? { data: { reason: trimmed } } : {}),
    }),
    order.id
  );
}
