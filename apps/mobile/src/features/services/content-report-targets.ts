import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const uuid = z.string().uuid();
export async function fetchReportTargets(
  query: string,
  locale: string,
  cursor: string | null,
  generation: number,
  signal: AbortSignal
) {
  const current = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Report session expired.");
  };
  current();
  if (cursor) uuid.parse(cursor);
  const page = z
    .object({
      items: z.array(z.object({ id: uuid, title: z.string(), roomNumber: z.string() })),
      nextCursor: uuid.nullable(),
    })
    .parse(
      await api.get("/ip-commerce/ips", {
        service: "aurora",
        signal,
        retry: false,
        params: { q: query.trim() || undefined, locale, limit: 20, ...(cursor ? { cursor } : {}) },
      })
    );
  current();
  if (
    new Set(page.items.map((row) => row.id)).size !== page.items.length ||
    (cursor !== null && page.nextCursor === cursor)
  )
    throw new Error("Content pagination changed. Refresh to reload.");
  return page;
}
