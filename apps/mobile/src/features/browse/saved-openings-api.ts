import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { positionReceipt } from "@/features/services/position-create-api";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export type SavedOpeningScope = { userId: string; generation: number };
function current(scope: SavedOpeningScope, signal: AbortSignal) {
  id.parse(scope.userId);
  if (signal.aborted || getAuthGeneration() !== scope.generation)
    throw Error("Opening session expired.");
}
const savedState = z.object({ saved: z.boolean() }).strict();
export async function readSavedOpening(
  scope: SavedOpeningScope,
  positionId: string,
  signal: AbortSignal
) {
  current(scope, signal);
  id.parse(positionId);
  const data = savedState.parse(
    await api.get(`/positions/${positionId}/saved`, {
      service: "aurora",
      credentials: "include",
      retry: false,
      signal,
    })
  );
  current(scope, signal);
  return data.saved;
}
export async function setSavedOpening(
  scope: SavedOpeningScope,
  positionId: string,
  saved: boolean,
  signal: AbortSignal
) {
  current(scope, signal);
  id.parse(positionId);
  const data = savedState.parse(
    await api[saved ? "put" : "delete"](`/positions/${positionId}/saved`, {
      service: "aurora",
      credentials: "include",
      retry: false,
      signal,
    })
  );
  current(scope, signal);
  if (data.saved !== saved)
    throw Error("The opening save response could not be verified. Refresh its saved state.");
  return data.saved;
}
export const savedPage = z.object({
  items: z
    .array(
      z.object({
        position: positionReceipt,
        crew: z.object({
          id,
          name: z.string(),
          logo: z.string().nullable(),
          tagline: z.string().nullable(),
          genres: z.array(z.string()),
          styles: z.array(z.string()),
        }),
      })
    )
    .max(20),
  nextCursor: id.nullable(),
  total: z.number().int().nonnegative().safe(),
});
export type SavedOpeningsPage = z.infer<typeof savedPage>;
export async function fetchSavedOpenings(
  scope: SavedOpeningScope,
  cursor: string | null,
  signal: AbortSignal
) {
  current(scope, signal);
  if (cursor) id.parse(cursor);
  const page = savedPage.parse(
    await api.get("/positions", {
      service: "aurora",
      credentials: "include",
      retry: false,
      signal,
      params: { saved: "true", limit: 20, sort: "newest", ...(cursor ? { cursor } : {}) },
    })
  );
  current(scope, signal);
  if (
    page.items.some(
      ({ position, crew }) =>
        position.crewId !== crew.id ||
        position.status !== "open" ||
        position.recruitmentVisibility !== "public"
    ) ||
    page.items.length > page.total ||
    new Set(page.items.map((item) => item.position.id)).size !== page.items.length ||
    (page.nextCursor &&
      (page.nextCursor === cursor || page.nextCursor !== page.items.at(-1)?.position.id))
  )
    throw Error("Saved openings changed. Refresh the list.");
  return page;
}
