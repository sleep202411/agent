import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { episodeMove, moveEpisode, removeEpisode } from "./episode-organization-api";
import type { CrewEpisode } from "./episode-management-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn(), delete: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const rows: CrewEpisode[] = Array.from({ length: 4 }, (_, i) => ({
  id: `${i + 1}1111111-1111-4111-8111-111111111111`,
  crewId: "crew",
  version: 2,
  number: i + 1,
  title: `Episode ${i + 1}`,
  synopsis: "",
  status: "planned",
  durationSeconds: null,
  plannedReleaseAt: null,
  taskProgress: { total: 0, completed: 0, pendingReview: 0 },
}));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it.each([
  { index: 1, direction: "up" as const, before: null, after: rows[0]!.id },
  { index: 2, direction: "up" as const, before: rows[0]!.id, after: rows[1]!.id },
  { index: 1, direction: "down" as const, before: rows[2]!.id, after: rows[3]!.id },
  { index: 2, direction: "down" as const, before: rows[3]!.id, after: null },
])(
  "computes exact neighbor anchors without renumbering: %j",
  ({ index, direction, before, after }) => {
    expect(episodeMove(rows, rows[index]!.id, direction)).toEqual({
      expectedVersion: 2,
      beforeEpisodeId: before,
      afterEpisodeId: after,
    });
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3, 4]);
  }
);
it("rejects invalid boundaries, duplicates and cross-crew lists", () => {
  expect(() => episodeMove(rows, rows[0]!.id, "up")).toThrow();
  expect(() => episodeMove(rows, rows[3]!.id, "down")).toThrow();
  expect(() => episodeMove(rows, "missing", "up")).toThrow();
  expect(() => episodeMove([rows[0]!, rows[0]!], rows[0]!.id, "down")).toThrow();
  expect(() =>
    episodeMove([rows[0]!, { ...rows[1]!, crewId: "other" }], rows[0]!.id, "down")
  ).toThrow();
});
it("posts the original version and anchors", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...rows[1], version: 3 });
  await moveEpisode(rows, rows[1]!.id, "up", 1);
  expect(api.post).toHaveBeenCalledWith(`/crew-episodes/${rows[1]!.id}/reorder`, {
    service: "aurora",
    data: { expectedVersion: 2, beforeEpisodeId: null, afterEpisodeId: rows[0]!.id },
  });
});
it.each([{ version: 2 }, { crewId: "other" }, { id: rows[0]!.id }])(
  "rejects incorrect reorder acknowledgement",
  async (patch) => {
    vi.mocked(api.post).mockResolvedValue({ ...rows[1], version: 3, ...patch });
    await expect(moveEpisode(rows, rows[1]!.id, "up", 1)).rejects.toThrow("response mismatch");
  }
);
it("blocks stale accounts before either mutation", async () => {
  h.generation = 2;
  await expect(moveEpisode(rows, rows[1]!.id, "up", 1)).rejects.toThrow("session expired");
  await expect(removeEpisode(rows[0]!, 1)).rejects.toThrow("session expired");
  expect(api.post).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
});
it("blocks known task-bearing episodes and preserves server history conflicts", async () => {
  await expect(
    removeEpisode({ ...rows[0]!, taskProgress: { total: 1, completed: 0, pendingReview: 0 } }, 1)
  ).rejects.toThrow("with tasks");
  expect(api.delete).not.toHaveBeenCalled();
  vi.mocked(api.delete).mockRejectedValue(new Error("CREW_EPISODE_NOT_EMPTY"));
  await expect(removeEpisode(rows[0]!, 1)).rejects.toThrow("CREW_EPISODE_NOT_EMPTY");
});
it("uses the authorized delete contract without inventing a version parameter", async () => {
  await removeEpisode(rows[0]!, 1);
  expect(api.delete).toHaveBeenCalledWith(`/crew-episodes/${rows[0]!.id}`, { service: "aurora" });
});
