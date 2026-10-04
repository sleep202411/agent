import { beforeEach, expect, it, vi } from "vitest";
import { fetchTaskCenter, type CenterFilters } from "./task-center-api";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "11111111-1111-4111-8111-111111111111",
  crewId = "22222222-2222-4222-8222-222222222222";
const filters: CenterFilters = {
  scope: "managed",
  status: "submitted",
  crewId,
  taskKind: "script",
  query: " draft ",
};
const task = {
  id,
  title: "Draft",
  number: 1,
  taskKind: "script",
  crew: { id: crewId, name: "Production" },
  status: "submitted",
  workflowState: { name: "Review", semantic: "submitted", systemKey: null },
  priority: "normal",
  dueAt: null,
  canSubmit: false,
  canReview: true,
  deadlineRisk: null,
};
const page = () => ({
  items: [task],
  nextCursor: null,
  crews: [task.crew],
  categories: ["script"],
  stats: { dueSoon: 0, pendingReviews: 1 },
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(page());
});
it("uses official scope/filter contract, disables retry, validates review capabilities", async () => {
  const signal = new AbortController().signal;
  expect((await fetchTaskCenter(filters, null, 1, signal)).items[0]?.canReview).toBe(true);
  expect(h.get).toHaveBeenCalledWith("/crew-task-center", {
    service: "aurora",
    signal,
    retry: false,
    params: {
      scope: "managed",
      status: "submitted",
      query: "draft",
      crewId,
      taskKind: "script",
      limit: 30,
    },
  });
});
it.each(["crew", "kind", "status", "duplicate", "cursor", "stats"])(
  "rejects malformed or mismatched %s responses",
  async (kind) => {
    const p = page();
    if (kind === "crew") p.items = [{ ...task, crew: { id, name: "Other" } }];
    if (kind === "kind") p.items = [{ ...task, taskKind: "music" }];
    if (kind === "status") p.items = [{ ...task, status: "approved" }];
    if (kind === "duplicate") p.items.push(task);
    if (kind === "stats") p.stats.dueSoon = -1;
    h.get.mockResolvedValue(kind === "cursor" ? { ...p, nextCursor: id } : p);
    await expect(
      fetchTaskCenter(filters, kind === "cursor" ? id : null, 1, new AbortController().signal)
    ).rejects.toThrow();
  }
);
it("rejects stale sessions both before and after a request", async () => {
  h.generation = 2;
  await expect(fetchTaskCenter(filters, null, 1, new AbortController().signal)).rejects.toThrow(
    "session"
  );
  expect(h.get).not.toHaveBeenCalled();
  h.generation = 1;
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return page();
  });
  await expect(fetchTaskCenter(filters, null, 1, new AbortController().signal)).rejects.toThrow(
    "session"
  );
});
it("does not turn permission failures into empty successful feeds", async () => {
  const cause = Object.assign(new Error("No access"), { status: 403 });
  h.get.mockRejectedValue(cause);
  await expect(fetchTaskCenter(filters, null, 1, new AbortController().signal)).rejects.toBe(cause);
});

it("requests linked contracts and preserves their node IDs", async () => {
  h.get.mockResolvedValue({ ...page(), items: [{ ...task, contractAssetNodeId: id }] });
  expect(
    (
      await fetchTaskCenter(
        { ...filters, hasContract: true },
        null,
        1,
        new AbortController().signal
      )
    ).items[0]?.contractAssetNodeId
  ).toBe(id);
  expect(h.get.mock.calls[0][1].params.hasContract).toBe("true");
  h.get.mockResolvedValue(page());
  await expect(
    fetchTaskCenter({ ...filters, hasContract: true }, null, 1, new AbortController().signal)
  ).rejects.toThrow("Invalid task");
});
