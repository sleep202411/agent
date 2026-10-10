import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
const id = z.string().uuid();
export const purchaseReportReasons = [
  "payment",
  "copyright",
  "unsafe_content",
  "fraud",
  "misleading",
  "privacy",
  "harassment",
  "other",
] as const;
const purchase = z
  .object({
    id,
    orderNo: z.string(),
    ipId: id,
    episodeId: id.nullable(),
    targetType: z.enum(["ip", "episode"]),
    currency: z.string(),
    totalAmount: z.string().regex(/^\d+(?:\.\d+)?$/),
    status: z.enum([
      "pending",
      "paid",
      "fulfilled",
      "canceled",
      "failed",
      "refunded",
      "partially_refunded",
    ]),
    createdAt: z.string().datetime({ offset: true }),
  })
  .refine(
    (row) => (row.targetType === "episode" ? !!row.episodeId : row.episodeId === null),
    "Purchase target mismatch."
  );
export type ReportPurchase = z.infer<typeof purchase>;
function current(generation: number, signal?: AbortSignal) {
  if (signal?.aborted || generation !== getAuthGeneration()) throw Error("Report session expired.");
}
export async function fetchReportPurchases(
  query: string,
  cursor: string | null,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  const page = z.object({ items: z.array(purchase), nextCursor: id.nullable() }).parse(
    await api.get("/ip-commerce/me/report-purchases", {
      service: "aurora",
      signal,
      retry: false,
      cache: "no-store",
      params: {
        query: z.string().trim().max(180).parse(query) || undefined,
        limit: 20,
        ...(cursor ? { cursor: id.parse(cursor) } : {}),
      },
    })
  );
  current(generation, signal);
  if (
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (cursor && cursor === page.nextCursor)
  )
    throw Error("Purchase pagination did not advance.");
  return page;
}
export const purchaseReportCommand = z.object({
  clientKey: id,
  purchaseOrderId: id,
  orderNo: z.string(),
  targetType: z.enum(["ip", "episode"]),
  targetId: id,
  reason: z.enum(purchaseReportReasons),
  description: z.string().trim().max(2000),
});
export type PurchaseReportCommand = z.infer<typeof purchaseReportCommand>;
export function purchaseReportOutbox(userId: string, generation: number) {
  return pendingRequest(
    purchaseReportCommand,
    generation,
    durableRecord("purchase-report", userId, "new")
  );
}
export async function submitPurchaseReport(
  input: PurchaseReportCommand,
  generation: number,
  signal: AbortSignal
) {
  const request = purchaseReportCommand.parse(input);
  current(generation, signal);
  const { clientKey, orderNo: _orderNo, ...payload } = request;
  const result = z
    .object({
      report: z.object({
        id,
        status: z.enum(["submitted", "triaged", "actioned", "dismissed"]),
        targetType: z.enum(["ip", "episode"]),
        targetId: id,
        reason: z.enum(purchaseReportReasons),
      }),
    })
    .parse(
      await api.post("/ip-commerce/reports", {
        service: "aurora",
        signal,
        retry: false,
        data: { ...payload, description: payload.description || undefined, requestId: clientKey },
      })
    );
  current(generation, signal);
  if (
    result.report.id !== clientKey ||
    result.report.targetType !== request.targetType ||
    result.report.targetId !== request.targetId ||
    result.report.reason !== request.reason
  )
    throw Error("Purchase report receipt mismatch.");
  return result.report;
}
