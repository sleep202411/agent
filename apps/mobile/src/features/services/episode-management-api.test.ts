import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchCrewEpisodes,
  episodeMetadataInput,
  updateEpisodeMetadata,
  type CrewEpisode,
} from "./episode-management-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "11111111-1111-4111-8111-111111111111";
const episode: CrewEpisode = {
  id,
  crewId: "crew",
  version: 4,
  number: 1,
  title: "Pilot",
  synopsis: "",
  status: "completed",
  durationSeconds: 30,
  plannedReleaseAt: "2026-10-01T10:10:10.123Z",
  taskProgress: { completed: 4, total: 6, pendingReview: 2 },
};
const data = {
  expectedVersion: 4,
  number: 2,
  title: "New Pilot",
  synopsis: "Summary",
  durationSeconds: null,
  plannedReleaseAt: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("loads all episode states with server-approved and pending counts", async () => {
  vi.mocked(api.get).mockResolvedValue([episode]);
  const signal = new AbortController().signal;
  expect(await fetchCrewEpisodes("crew", signal)).toEqual([episode]);
  expect(api.get).toHaveBeenCalledWith("/crews/crew/episodes", { service: "aurora", signal });
});
it.each([{ rows: [{ ...episode, crewId: "other" }] }, { rows: [episode, episode] }])(
  "rejects cross-crew or duplicate episode lists",
  async ({ rows }) => {
    vi.mocked(api.get).mockResolvedValue(rows);
    await expect(fetchCrewEpisodes("crew", new AbortController().signal)).rejects.toThrow(
      "scope mismatch"
    );
  }
);
it("updates only metadata with the original version and permits explicit clearing", async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...episode, ...data, version: 5 });
  await updateEpisodeMetadata(episode, data, 1);
  expect(api.patch).toHaveBeenCalledWith(`/crew-episodes/${id}`, { service: "aurora", data });
  expect(data).not.toHaveProperty("status");
});
it.each([
  { version: 4 },
  { crewId: "other" },
  { id: "22222222-2222-4222-8222-222222222222" },
  { status: "in_review" },
  { title: "Other" },
  { durationSeconds: 20 },
])("rejects mismatched acknowledgement %j", async (patch) => {
  vi.mocked(api.patch).mockResolvedValue({ ...episode, ...data, version: 5, ...patch });
  await expect(updateEpisodeMetadata(episode, data, 1)).rejects.toThrow();
});
it("does not post a stale version or foreign session", async () => {
  await expect(
    updateEpisodeMetadata(episode, { ...data, expectedVersion: 3 }, 1)
  ).rejects.toThrow();
  h.generation = 2;
  await expect(updateEpisodeMetadata(episode, data, 1)).rejects.toThrow();
  expect(api.patch).not.toHaveBeenCalled();
});
it("refuses approval states and invalid duration/date values", () => {
  for (const patch of [
    { status: "completed" },
    { durationSeconds: 0 },
    { durationSeconds: 86401 },
    { plannedReleaseAt: "not-a-date" },
  ])
    expect(() => episodeMetadataInput.parse({ ...data, ...patch })).toThrow();
});
