import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchTaskPlanning,
  planningChanges,
  planningDraft,
  updateTaskPlanning,
} from "./task-planning-edit-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const detail = {
  id,
  crewId: "crew",
  number: 1,
  title: "Shot",
  description: "Render",
  submissions: [],
  version: 1,
  revisionLimit: null,
  revisionRoundsUsed: 0,
  priority: "normal" as const,
  parent: null,
  children: [],
  blockedBy: [],
  blocking: [],
  status: "submitted",
  workflowState: { name: "Review" },
  startAt: null,
  dueAt: "2026-10-01T00:00:00Z",
  labels: [],
  assignees: [],
};

const other = "22222222-2222-4222-8222-222222222222";
const snapshot = {
  ...detail,
  taskKind: "storyboard" as const,
  estimatePoints: 8,
  cycleId: id,
  cycle: { id, name: "Sprint" },
  episodeId: id,
  episode: { id, number: 1, title: "Pilot" },
  labels: [{ id, name: "Art" }],
};
beforeEach(() => vi.resetAllMocks());
it("requires complete planning references and exact opening version", async () => {
  const signal = new AbortController().signal;
  vi.mocked(api.get).mockResolvedValue(snapshot);
  expect(await fetchTaskPlanning(detail, signal)).toEqual(snapshot);
  for (const change of [
    { version: 2 },
    { crewId: "other" },
    { id: other },
    { cycleId: undefined },
    { episodeId: undefined },
    { cycle: null },
    { episode: { id: other, number: 1, title: "Other" } },
  ]) {
    vi.mocked(api.get).mockResolvedValue({ ...snapshot, ...change });
    await expect(fetchTaskPlanning(detail, signal)).rejects.toThrow();
  }
});
it("only submits changed references, preserving unchanged closed planning records", async () => {
  const draft = planningDraft(snapshot);
  expect(planningChanges(snapshot, draft).success).toBe(false);
  const data = planningChanges(snapshot, { ...draft, labels: [] });
  expect(data.success).toBe(true);
  if (!data.success) throw new Error("Expected changes");
  expect(data.data).toEqual({ expectedVersion: 1, labelIds: [] });
  vi.mocked(api.patch).mockResolvedValue({ ...snapshot, version: 2, labels: [] });
  await updateTaskPlanning(snapshot, data.data);
  expect(api.patch).toHaveBeenCalledExactlyOnceWith(`/crew-tasks/${id}`, {
    service: "aurora",
    data: data.data,
  });
});
it("supports clearing and replacing cycle and episode", async () => {
  const data = { expectedVersion: 1, cycleId: null, episodeId: other };
  vi.mocked(api.patch).mockResolvedValue({
    ...snapshot,
    version: 2,
    cycleId: null,
    cycle: null,
    episodeId: other,
    episode: { id: other, number: 2, title: "Next" },
  });
  await expect(updateTaskPlanning(snapshot, data)).resolves.toMatchObject({
    cycleId: null,
    episodeId: other,
  });
  expect(
    planningChanges(snapshot, { ...planningDraft(snapshot), cycle: null, episode: null }).data
  ).toEqual({ expectedVersion: 1, cycleId: null, episodeId: null });
});
it("rejects invalid, duplicate, excessive, empty or wrong-version writes", async () => {
  for (const data of [
    { expectedVersion: 1 },
    { expectedVersion: 2, labelIds: [] },
    { expectedVersion: 1, cycleId: "bad" },
    { expectedVersion: 1, labelIds: [id, id] },
    { expectedVersion: 1, labelIds: Array(21).fill(id) },
  ]) {
    await expect(updateTaskPlanning(snapshot, data)).rejects.toThrow();
  }
  expect(api.patch).not.toHaveBeenCalled();
});
it("checks both updated and retained planning associations in acknowledgement", async () => {
  for (const change of [
    { version: 1 },
    { crewId: "wrong" },
    { cycleId: null, cycle: null },
    { episodeId: null, episode: null },
    { labels: [{ id, name: "Art" }] },
  ]) {
    vi.mocked(api.patch).mockResolvedValue({ ...snapshot, version: 2, labels: [], ...change });
    await expect(
      updateTaskPlanning(snapshot, { expectedVersion: 1, labelIds: [] })
    ).rejects.toThrow("acknowledgement");
  }
});
it("surfaces version conflicts without retrying", async () => {
  vi.mocked(api.patch).mockRejectedValue(new Error("Version changed"));
  await expect(updateTaskPlanning(snapshot, { expectedVersion: 1, cycleId: null })).rejects.toThrow(
    "Version changed"
  );
  expect(api.patch).toHaveBeenCalledOnce();
});

it("changes or clears only the kind without applying title templates", async () => {
  for (const taskKind of ["art", null] as const) {
    const changed = planningChanges(snapshot, planningDraft(snapshot), taskKind);
    expect(changed.data).toEqual({ expectedVersion: 1, taskKind });
    vi.mocked(api.patch).mockResolvedValue({ ...snapshot, version: 2, taskKind });
    await expect(
      updateTaskPlanning(snapshot, { expectedVersion: 1, taskKind })
    ).resolves.toMatchObject({
      taskKind,
      title: snapshot.title,
      description: snapshot.description,
    });
    expect(api.patch).toHaveBeenLastCalledWith(`/crew-tasks/${id}`, {
      service: "aurora",
      data: { expectedVersion: 1, taskKind },
    });
  }
});
it("rejects absent or invalid kinds in fresh snapshots", async () => {
  for (const taskKind of [undefined, "unknown"]) {
    vi.mocked(api.get).mockResolvedValue({ ...snapshot, taskKind });
    await expect(fetchTaskPlanning(detail, new AbortController().signal)).rejects.toThrow();
  }
});
it("requires the kind to match both changed and retained acknowledgements", async () => {
  vi.mocked(api.patch).mockResolvedValue({ ...snapshot, version: 2 });
  await expect(
    updateTaskPlanning(snapshot, { expectedVersion: 1, taskKind: "art" })
  ).rejects.toThrow("acknowledgement");
  vi.mocked(api.patch).mockResolvedValue({ ...snapshot, version: 2, labels: [], taskKind: null });
  await expect(updateTaskPlanning(snapshot, { expectedVersion: 1, labelIds: [] })).rejects.toThrow(
    "acknowledgement"
  );
});

it("updates or clears estimate and revision limit without resending retained planning", async () => {
  for (const values of [
    { estimatePoints: 0, revisionLimit: 3 },
    { estimatePoints: null, revisionLimit: null },
  ]) {
    const parsed = planningChanges(snapshot, planningDraft(snapshot), snapshot.taskKind, values);
    const expected = {
      expectedVersion: 1,
      ...(values.estimatePoints !== snapshot.estimatePoints
        ? { estimatePoints: values.estimatePoints }
        : {}),
      ...(values.revisionLimit !== snapshot.revisionLimit
        ? { revisionLimit: values.revisionLimit }
        : {}),
    };
    expect(parsed.data).toEqual(expected);
    vi.mocked(api.patch).mockResolvedValue({ ...snapshot, ...values, version: 2 });
    await expect(updateTaskPlanning(snapshot, expected)).resolves.toMatchObject(values);
  }
});
it("rejects invalid bounds and a limit below already-used rounds before writing", async () => {
  const used = { ...snapshot, revisionRoundsUsed: 2 };
  for (const fields of [
    { estimatePoints: -1 },
    { estimatePoints: 1000001 },
    { estimatePoints: 1.2 },
    { revisionLimit: 101 },
    { revisionLimit: 1 },
    { revisionLimit: 1.5 },
  ])
    await expect(updateTaskPlanning(used, { expectedVersion: 1, ...fields })).rejects.toThrow();
  expect(api.patch).not.toHaveBeenCalled();
  expect(
    planningChanges(used, planningDraft(used), used.taskKind, {
      estimatePoints: 8,
      revisionLimit: 1,
    }).success
  ).toBe(false);
});
it("requires complete estimate data and validates updated and retained numeric acknowledgements", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...snapshot, estimatePoints: undefined });
  await expect(fetchTaskPlanning(detail, new AbortController().signal)).rejects.toThrow();
  for (const change of [{ estimatePoints: 8 }, { revisionLimit: 1 }]) {
    vi.mocked(api.patch).mockResolvedValue({
      ...snapshot,
      version: 2,
      estimatePoints: 10,
      ...change,
    });
    await expect(
      updateTaskPlanning(snapshot, { expectedVersion: 1, estimatePoints: 10 })
    ).rejects.toThrow("acknowledgement");
  }
});
