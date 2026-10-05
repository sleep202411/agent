import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const uuid = z.string().uuid();
export const reportViews = ["initiated", "responses"] as const;
export type ReportView = (typeof reportViews)[number];
const report = z.object({
  id: uuid,
  targetType: z.enum(["ip", "episode"]),
  targetId: uuid,
  purchaseOrderId: uuid.nullish(),
  reason: z.enum([
    "payment",
    "copyright",
    "unsafe_content",
    "fraud",
    "misleading",
    "privacy",
    "harassment",
    "other",
  ]),
  status: z.enum(["submitted", "triaged", "actioned", "dismissed"]),
  createdAt: z.string().datetime({ offset: true }),
  resolutionNote: z.string().nullable(),
  description: z.string().nullish(),
});
export type ContentReport = z.infer<typeof report>;
export async function fetchContentReports(
  generation: number,
  view: ReportView,
  cursor: string | null,
  signal: AbortSignal
) {
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Report session expired.");
  };
  current();
  z.enum(reportViews).parse(view);
  if (cursor) uuid.parse(cursor);
  const page = z.object({ items: z.array(report), nextCursor: uuid.nullable() }).parse(
    await api.get("/ip-commerce/me/reports", {
      service: "aurora",
      signal,
      retry: false,
      params: { view, limit: 20, ...(cursor ? { cursor } : {}) },
    })
  );
  current();
  if (
    new Set(page.items.map((item) => item.id)).size !== page.items.length ||
    (cursor !== null && cursor === page.nextCursor) ||
    (view === "responses" &&
      page.items.some((item) => !["actioned", "dismissed"].includes(item.status)))
  )
    throw new Error("Report scope or pagination changed. Refresh to reload.");
  // Respondents only see the public outcome, never a reporter's submitted details.
  return {
    ...page,
    items: page.items.map((item) =>
      view === "responses" ? { ...item, description: undefined, purchaseOrderId: undefined } : item
    ),
  };
}
