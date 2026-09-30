import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
export const crewEpisode = z.object({
  id: z.string().uuid(),
  crewId: z.string().min(1),
  version: z.number().int().positive(),
  number: z.number().int().positive(),
  title: z.string().min(1),
  synopsis: z.string(),
  status: z.enum(["planned", "in_production", "in_review", "completed", "cancelled"]),
  durationSeconds: z.number().int().positive().nullable(),
  plannedReleaseAt: z.string().datetime({ offset: true }).nullable(),
  taskProgress: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    pendingReview: z.number().int().nonnegative(),
  }),
});
export type CrewEpisode = z.infer<typeof crewEpisode>;
export async function fetchCrewEpisodes(crewId: string, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  const rows = z
    .array(crewEpisode)
    .parse(await api.get(`/crews/${crewId}/episodes`, { service: "aurora", signal }));
  if (
    rows.some((row) => row.crewId !== crewId) ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw new Error("Episode list scope mismatch");
  return rows;
}
export const episodeMetadataInput = z
  .object({
    expectedVersion: z.number().int().positive(),
    number: z.number().int().positive().max(100000),
    title: z.string().trim().min(1).max(180),
    synopsis: z.string().trim().max(20000),
    durationSeconds: z.number().int().positive().max(86400).nullable(),
    plannedReleaseAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export async function updateEpisodeMetadata(
  episode: CrewEpisode,
  input: z.infer<typeof episodeMetadataInput>,
  generation: number
) {
  z.string().uuid().parse(episode.id);
  const data = episodeMetadataInput.parse(input);
  if (data.expectedVersion !== episode.version) throw new Error("Episode version mismatch");
  if (generation !== getAuthGeneration()) throw new Error("Episode editing session expired");
  const result = crewEpisode.parse(
    await api.patch(`/crew-episodes/${episode.id}`, { service: "aurora", data })
  );
  const sameDate = (a: string | null, b: string | null) =>
    a === null || b === null ? a === b : Date.parse(a) === Date.parse(b);
  if (
    result.id !== episode.id ||
    result.crewId !== episode.crewId ||
    result.version !== episode.version + 1 ||
    result.number !== data.number ||
    result.title !== data.title ||
    result.synopsis !== data.synopsis ||
    result.durationSeconds !== data.durationSeconds ||
    !sameDate(result.plannedReleaseAt, data.plannedReleaseAt) ||
    result.status !== episode.status
  )
    throw new Error("Episode update response mismatch. Refresh before editing again.");
  return result;
}
