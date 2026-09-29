import { ORDER_STATUSES } from "@repo/shared/order";
import { z } from "zod";
import { api } from "@/lib/api-client";
export type OrderRole = "both" | "buyer" | "creator";
export type OrderFilter = "" | (typeof ORDER_STATUSES)[number];
const card = z.object({
  id: z.string().min(1),
  serviceTitle: z.string(),
  packageTier: z.enum(["basic", "standard", "premium"]),
  status: z.enum(ORDER_STATUSES),
  totalPrice: z.number().finite().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  counterpartyId: z.string().min(1),
  counterpartyRole: z.enum(["buyer", "creator"]),
  unreadCount: z.number().int().nonnegative(),
});
const page = z.object({ items: z.array(card), nextCursor: z.string().min(1).nullable() });
export type OrderListItem = z.infer<typeof card>;
export async function fetchOrders(
  role: OrderRole,
  status: OrderFilter,
  cursor: string | null,
  signal: AbortSignal
) {
  return page.parse(
    await api.get("/orders", {
      service: "aurora",
      signal,
      params: { role, ...(status ? { status } : {}), limit: 24, ...(cursor ? { cursor } : {}) },
    })
  );
}
