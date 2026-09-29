import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { crewEpisode, type CrewEpisode } from "./episode-management-api";
export function episodeMove(rows: CrewEpisode[], id: string, direction: "up" | "down") {
  const list = z.array(crewEpisode).parse(rows);
  z.enum(["up", "down"]).parse(direction);
  const index = list.findIndex((row) => row.id === id),
    target = index + (direction === "up" ? -1 : 1);
  if (
    index < 0 ||
    target < 0 ||
    target >= list.length ||
    new Set(list.map((row) => row.id)).size !== list.length ||
    list.some((row) => row.crewId !== list[index]!.crewId)
  )
    throw new Error("Invalid episode order");
  const ordered = [...list];
  const [moved] = ordered.splice(index, 1);
  ordered.splice(target, 0, moved!);
  return {
    expectedVersion: moved!.version,
    beforeEpisodeId: ordered[target - 1]?.id ?? null,
    afterEpisodeId: ordered[target + 1]?.id ?? null,
  };
}
function session(generation: number) {
  if (generation !== getAuthGeneration()) throw new Error("Episode organization session expired");
}
export async function moveEpisode(
  rows: CrewEpisode[],
  id: string,
  direction: "up" | "down",
  generation: number
) {
  const data = episodeMove(rows, id, direction),
    current = rows.find((row) => row.id === id)!;
  session(generation);
  const result = crewEpisode.parse(
    await api.post(`/crew-episodes/${id}/reorder`, { service: "aurora", data })
  );
  session(generation);
  if (
    result.id !== id ||
    result.crewId !== current.crewId ||
    result.version !== current.version + 1
  )
    throw new Error("Episode reorder response mismatch. Refresh before continuing.");
  return result;
}
export async function removeEpisode(episode: CrewEpisode, generation: number) {
  const snapshot = crewEpisode.parse(episode);
  if (snapshot.taskProgress.total > 0) throw new Error("Episodes with tasks cannot be deleted");
  session(generation);
  // The route has no expectedVersion parameter; server locks and checks all task/delivery history.
  await api.delete(`/crew-episodes/${snapshot.id}`, { service: "aurora" });
  session(generation);
}
