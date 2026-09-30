import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchTaskPlanningOptions, type PlanningKind } from "./task-planning-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111";
const row = { id, crewId: "crew", name: "Sprint", title: "Pilot", number: 1, status: "planned" };
const signal = new AbortController().signal;
beforeEach(() => vi.resetAllMocks());
it("reads scoped labels and cycles from the task project", async () => {
  vi.mocked(api.get).mockResolvedValue({ labels: [row], cycles: [row] });
  for (const kind of ["labels", "cycle"] as const)
    expect(await fetchTaskPlanningOptions("crew", kind, signal)).toEqual([{ id, name: "Sprint" }]);
  expect(api.get).toHaveBeenCalledWith("/crews/crew/task-project", { service: "aurora", signal });
});
it("filters cancelled cycles but retains completed cycles accepted by the server", async () => {
  for (const status of ["planned", "active", "completed", "cancelled"]) {
    vi.mocked(api.get).mockResolvedValue({ cycles: [{ ...row, status }] });
    expect((await fetchTaskPlanningOptions("crew", "cycle", signal)).length).toBe(
      status === "cancelled" ? 0 : 1
    );
  }
});
it("loads production episodes separately and excludes completed and cancelled", async () => {
  for (const status of ["planned", "in_production", "in_review", "completed", "cancelled"]) {
    vi.mocked(api.get).mockResolvedValue([{ ...row, status }]);
    expect((await fetchTaskPlanningOptions("crew", "episode", signal)).length).toBe(
      ["completed", "cancelled"].includes(status) ? 0 : 1
    );
  }
  expect(api.get).toHaveBeenCalledWith("/crews/crew/episodes", { service: "aurora", signal });
  vi.mocked(api.get).mockResolvedValue([row]);
  expect(await fetchTaskPlanningOptions("crew", "episode", signal)).toEqual([
    { id, name: "1 · Pilot" },
  ]);
});
it("rejects cross-Crew records and duplicate identifiers for all kinds", async () => {
  for (const kind of ["labels", "cycle", "episode"] as PlanningKind[]) {
    for (const rows of [[{ ...row, crewId: "other" }], [row, row]]) {
      vi.mocked(api.get).mockResolvedValue(
        kind === "episode" ? rows : { [kind === "cycle" ? "cycles" : "labels"]: rows }
      );
      await expect(fetchTaskPlanningOptions("crew", kind, signal)).rejects.toThrow("scope");
    }
  }
});
it("surfaces permissions and malformed data instead of showing false empty lists", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Production permission required"));
  await expect(fetchTaskPlanningOptions("crew", "episode", signal)).rejects.toThrow(
    "Production permission"
  );
  vi.mocked(api.get).mockResolvedValue({ labels: [{ ...row, id: "bad" }] });
  await expect(fetchTaskPlanningOptions("crew", "labels", signal)).rejects.toThrow();
});
