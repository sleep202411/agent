import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { agreementStatuses } from "./agreement-detail-api";
import { agreementViews, type AgreementView } from "./crew-agreements-api";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const item = z.object({
  id: z.string().uuid(),
  crewId: id,
  title: z.string(),
  status: z.enum(agreementStatuses),
  updatedAt: z.string().datetime({ offset: true }),
  crew: z.object({ name: z.string() }),
});
const pageSchema = z.object({ items: z.array(item), nextCursor: id.nullable() });
export type MyAgreement = z.infer<typeof item>;
export async function fetchMyAgreements(
  generation: number,
  view: AgreementView,
  cursor: string | null,
  signal: AbortSignal
) {
  const current = () => {
    if (signal.aborted || getAuthGeneration() !== generation)
      throw new Error("Agreement session expired.");
  };
  current();
  z.enum(agreementViews).parse(view);
  if (cursor) id.parse(cursor);
  const page = pageSchema.parse(
    await api.get("/me/crew-agreements", {
      service: "aurora",
      signal,
      retry: false,
      params: { view, limit: 30, ...(cursor ? { cursor } : {}) },
    })
  );
  current();
  const statuses =
    view === "active"
      ? ["draft", "sending", "sent"]
      : view === "signed"
        ? ["signed"]
        : view === "attention"
          ? ["declined", "expired", "failed", "voided"]
          : null;
  if (
    page.items.some((row) => statuses && !statuses.includes(row.status)) ||
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (cursor !== null && page.nextCursor === cursor)
  )
    throw new Error("Agreement scope or pagination changed. Refresh to reload.");
  return page;
}
