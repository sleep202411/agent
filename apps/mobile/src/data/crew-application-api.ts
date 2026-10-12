import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const receipt = z.object({ id, crewId: id, positionId: id, status: z.literal("pending") });

/** Recover the private application discussion before attempting a new application. */
export async function applyToCrewPosition(
  crewId: string,
  positionId: string,
  signal?: AbortSignal
): Promise<string> {
  id.parse(crewId);
  id.parse(positionId);
  const generation = getAuthGeneration();
  const current = () => {
    if (signal?.aborted || generation !== getAuthGeneration())
      throw new Error("Application session changed. Reopen the position to continue.");
  };
  const verify = (value: unknown) => {
    const row = receipt.parse(value);
    if (row.crewId !== crewId || row.positionId !== positionId)
      throw new Error("Application response did not match this position. Reopen it to continue.");
    return row.id;
  };
  current();
  const page = z.object({ items: z.array(receipt).max(1) }).parse(
    await api.get("/me/crew-applications", {
      service: "aurora",
      signal,
      cache: "no-store",
      params: { positionId, status: "pending", limit: 1 },
    })
  );
  current();
  if (page.items.length) return verify(page.items[0]);
  const created = await api.post(`/crews/${crewId}/positions/${positionId}/apply`, {
    service: "aurora",
    signal,
    data: {},
  });
  current();
  return verify(created);
}
