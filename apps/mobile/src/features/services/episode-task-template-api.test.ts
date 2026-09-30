import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  applyEpisodeTaskPlan,
  fetchEpisodeTaskPlan,
  episodeTaskPlan,
} from "./episode-task-template-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "11111111-1111-4111-8111-111111111111";
const plan = {
  templateId: id,
  templateVersion: 3,
  episodeVersion: 8,
  name: "Series",
  items: [
    {
      templateKey: "script",
      title: "Script",
      roleRequirement: "Writer",
      defaultDependencies: [],
      deliveryFields: [],
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("previews without creating and sends only the exact approved version snapshot", async () => {
  vi.mocked(api.get).mockResolvedValue(plan);
  vi.mocked(api.post).mockResolvedValue({ taskIds: [id], replayed: false });
  const signal = new AbortController().signal;
  expect(await fetchEpisodeTaskPlan("crew", id, signal)).toEqual(plan);
  expect(api.post).not.toHaveBeenCalled();
  expect(await applyEpisodeTaskPlan("crew", id, plan, 1)).toEqual({
    taskIds: [id],
    replayed: false,
  });
  expect(api.post).toHaveBeenCalledWith(`/crews/crew/episodes/${id}/task-template`, {
    service: "aurora",
    data: { templateId: id, templateVersion: 3, episodeVersion: 8 },
  });
});
it("permits explicit retry with the same snapshot and accepts a replay receipt", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValueOnce({ taskIds: [id], replayed: true });
  await expect(applyEpisodeTaskPlan("crew", id, plan, 1)).rejects.toThrow();
  expect((await applyEpisodeTaskPlan("crew", id, plan, 1)).replayed).toBe(true);
  expect(vi.mocked(api.post).mock.calls[0]).toEqual(vi.mocked(api.post).mock.calls[1]);
});
it("blocks stale sessions and invalid scope before posting", async () => {
  h.generation = 2;
  await expect(applyEpisodeTaskPlan("crew", id, plan, 1)).rejects.toThrow();
  h.generation = 1;
  await expect(applyEpisodeTaskPlan("../crew", id, plan, 1)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each([0, -1, 1.5])("rejects invalid template versions %s", (version) => {
  expect(() => episodeTaskPlan.parse({ ...plan, templateVersion: version })).toThrow();
});
it("rejects duplicate task keys, unknown dependencies and malformed receipts", async () => {
  expect(() => episodeTaskPlan.parse({ ...plan, items: [plan.items[0], plan.items[0]] })).toThrow();
  expect(() =>
    episodeTaskPlan.parse({
      ...plan,
      items: [{ ...plan.items[0], defaultDependencies: ["missing"] }],
    })
  ).toThrow();
  vi.mocked(api.post).mockResolvedValue({ taskIds: [id, id], replayed: false });
  await expect(applyEpisodeTaskPlan("crew", id, plan, 1)).rejects.toThrow();
});

it("retains per-task fields in the pinned command through retry", async () => {
  const reviewed = {
    ...plan,
    taskFields: [{ templateKey: "script", values: [{ fieldId: id, value: "Brief" }] }],
  };
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ taskIds: [id], replayed: true });
  await expect(applyEpisodeTaskPlan("crew", id, reviewed, 1)).rejects.toThrow("offline");
  await applyEpisodeTaskPlan("crew", id, reviewed, 1);
  expect(vi.mocked(api.post).mock.calls[0]).toEqual(vi.mocked(api.post).mock.calls[1]);
  expect(vi.mocked(api.post).mock.calls[1][1]?.data).toEqual({
    templateId: id,
    templateVersion: 3,
    episodeVersion: 8,
    taskFields: reviewed.taskFields,
  });
});
it("rejects foreign task keys and repeated fields before submitting", async () => {
  for (const taskFields of [
    [{ templateKey: "foreign", values: [] }],
    [
      { templateKey: "script", values: [] },
      { templateKey: "script", values: [] },
    ],
    [
      {
        templateKey: "script",
        values: [
          { fieldId: id, value: "A" },
          { fieldId: id, value: "B" },
        ],
      },
    ],
  ])
    await expect(applyEpisodeTaskPlan("crew", id, { ...plan, taskFields }, 1)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
