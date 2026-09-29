import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const crew = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const episodeCreateInput = z
  .object({
    title: z.string().trim().min(1).max(180),
    synopsis: z.string().trim().max(20000),
    number: z.number().int().positive().max(100000).optional(),
  })
  .strict();
export async function fetchEpisodeCreateAccess(
  crewId: string,
  userId: string,
  signal: AbortSignal
) {
  crew.parse(crewId);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  if (member.userId !== userId) throw new Error("Crew membership account mismatch");
  return member.permissions.includes("production.manage");
}
const episode = z.object({
  id: z.string().uuid(),
  crewId: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  synopsis: z.string(),
  status: z.literal("planned"),
  createdByUserId: z.string(),
});
export async function createEpisode(
  crewId: string,
  userId: string,
  generation: number,
  input: z.infer<typeof episodeCreateInput>
) {
  crew.parse(crewId);
  const data = episodeCreateInput.parse(input);
  if (generation !== getAuthGeneration()) throw new Error("Episode creation session expired");
  const result = episode.parse(
    await api.post(`/crews/${crewId}/episodes`, {
      service: "aurora",
      data: { ...data, status: "planned" },
    })
  );
  if (
    result.crewId !== crewId ||
    result.createdByUserId !== userId ||
    result.title !== data.title ||
    result.synopsis !== data.synopsis ||
    (data.number !== undefined && result.number !== data.number)
  )
    throw new Error(
      "Episode creation response mismatch. Check the episode list before creating again."
    );
  return result;
}
