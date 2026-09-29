import { z } from "zod";
import { api } from "@/lib/api-client";
import { agreement } from "./agreement-detail-api";
export const agreementViews = ["all", "active", "signed", "attention"] as const;
export type AgreementView = (typeof agreementViews)[number];
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const count = z.number().int().nonnegative();
const response = z.object({
  capabilities: z.object({ create: z.boolean() }),
  items: z.array(agreement),
  nextCursor: id.nullable(),
  total: count,
  summary: z.object({ all: count, active: count, signed: count, attention: count }),
});
export type AgreementPage = z.infer<typeof response>;
export async function fetchCrewAgreements(
  crewId: string,
  view: AgreementView,
  cursor: string | null,
  signal: AbortSignal
) {
  id.parse(crewId);
  z.enum(agreementViews).parse(view);
  if (cursor) id.parse(cursor);
  const page = response.parse(
    await api.get(`/crews/${crewId}/agreements`, {
      service: "aurora",
      signal,
      params: { view, limit: 50, ...(cursor ? { cursor } : {}) },
    })
  );
  const statuses =
    view === "active"
      ? ["draft", "sending", "sent"]
      : view === "signed"
        ? ["signed"]
        : view === "attention"
          ? ["declined", "expired", "failed", "voided"]
          : null;
  if (
    page.items.some(
      (item) => item.crewId !== crewId || (statuses && !statuses.includes(item.status))
    ) ||
    new Set(page.items.map((i) => i.id)).size !== page.items.length ||
    (cursor !== null && page.nextCursor === cursor)
  )
    throw new Error("Agreement scope or pagination changed. Refresh to reload.");
  return page;
}
