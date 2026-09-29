import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskCreationDefaults } from "./task-creation-defaults";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = (n: number, semantic = "open", systemKey: string | null = null) => ({
  id: uid(n),
  crewId: "crew",
  name: `State ${n}`,
  semantic,
  systemKey,
  archived: false,
});
const makeProject = () => ({
  views: [
    { id: uid(1), crewId: "crew", filters: { cycleIds: [uid(4)], workflowStateIds: [uid(6)] } },
  ],
  cycles: [
    { id: uid(3), crewId: "crew", name: "Current", status: "active" },
    { id: uid(4), crewId: "crew", name: "Next", status: "planned" },
  ],
  workflowStates: [
    state(5, "open", "open"),
    state(6, "in_progress"),
    state(7, "revision_requested"),
  ],
});
let project: ReturnType<typeof makeProject>;
const signal = new AbortController().signal;
const fetchDefaults = (viewId?: string, presetId?: string) =>
  fetchTaskCreationDefaults("crew", viewId, presetId, signal);
beforeEach(() => {
  vi.resetAllMocks();
  project = makeProject();
  vi.mocked(api.get).mockImplementation(async () => project);
});
it("uses first server view and a planned filtered cycle with the filtered workflow", async () => {
  expect(await fetchDefaults()).toMatchObject({
    cycle: { id: uid(4), name: "Next" },
    workflow: { id: uid(6) },
  });
  expect(api.get).toHaveBeenCalledWith("/crews/crew/task-project", { service: "aurora", signal });
});
it("uses selected view rather than first view; parent's valid workflow takes precedence", async () => {
  project.views.push({
    id: uid(2),
    crewId: "crew",
    filters: { cycleIds: [uid(3)], workflowStateIds: [uid(5)] },
  });
  expect(await fetchDefaults(uid(2))).toMatchObject({
    cycle: { id: uid(3) },
    workflow: { id: uid(5) },
  });
  expect(await fetchDefaults(uid(2), uid(7))).toMatchObject({ workflow: { id: uid(7) } });
});
it.each(["cancelled", "missing", "multiple"])(
  "falls back to active cycle for %s filter",
  async (kind) => {
    if (kind === "cancelled") project.cycles[1]!.status = "cancelled";
    if (kind === "missing") project.views[0]!.filters.cycleIds = [uid(99)];
    if (kind === "multiple") project.views[0]!.filters.cycleIds.push(uid(3));
    expect(await fetchDefaults()).toMatchObject({ cycle: { id: uid(3) } });
  }
);
it("retains a completed selected cycle, matching Web", async () => {
  project.cycles[1]!.status = "completed";
  expect(await fetchDefaults()).toMatchObject({ cycle: { id: uid(4) } });
});
it.each(["submitted", "approved", "cancelled", "archived", "missing", "multiple"])(
  "uses open default for %s workflow",
  async (kind) => {
    if (["submitted", "approved", "cancelled"].includes(kind))
      project.workflowStates[1]!.semantic = kind;
    if (kind === "archived") project.workflowStates[1]!.archived = true;
    if (kind === "missing") project.views[0]!.filters.workflowStateIds = [uid(99)];
    if (kind === "multiple") project.views[0]!.filters.workflowStateIds.push(uid(7));
    expect(await fetchDefaults(undefined, uid(99))).toMatchObject({ workflow: { id: uid(5) } });
  }
);
it("falls back to first view if selected view was removed", async () => {
  expect(await fetchDefaults(uid(99))).toMatchObject({
    cycle: { id: uid(4) },
    workflow: { id: uid(6) },
  });
});
it("handles empty project without inventing IDs", async () => {
  project.views = [];
  project.cycles = [];
  project.workflowStates = [];
  expect(await fetchDefaults()).toEqual({ cycle: null, workflow: null });
});
it.each(["views", "cycles", "workflowStates"] as const)(
  "rejects foreign and duplicate %s rows",
  async (key) => {
    project[key][0]!.crewId = "other";
    await expect(fetchDefaults()).rejects.toThrow("scope mismatch");
    project = makeProject();
    const rows = project[key] as { id: string; crewId: string }[];
    rows.push(rows[0]!);
    await expect(fetchDefaults()).rejects.toThrow("scope mismatch");
  }
);
it("rejects invalid scope before network and surfaces failures", async () => {
  await expect(
    fetchTaskCreationDefaults("../crew", undefined, undefined, signal)
  ).rejects.toThrow();
  expect(api.get).not.toHaveBeenCalled();
  vi.mocked(api.get).mockRejectedValue(new Error("Project unavailable"));
  await expect(fetchDefaults()).rejects.toThrow("Project unavailable");
});
