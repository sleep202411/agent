import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCompute, createCompute } from "./crew-compute-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111",
  next = "22222222-2222-4222-8222-222222222222";
const row = {
  id,
  crewId: "crew",
  userId: "creator",
  requestedByUserId: "user",
  remainingWorkload: "1.5",
  workloadUnit: "hours",
  taskId: id,
  taskTitle: "Scene",
  points: 20,
  reason: "Render",
  status: "pending",
  createdAt: "2026-09-30T00:00:00Z",
  decidedByAdminId: null,
  decidedByUserId: null,
  decisionNote: null,
  requestKey: next,
};
const page = {
  isOwner: true,
  workspaceLinked: true,
  consumedPoints: "9007199254740993",
  totals: { pending: 20 },
  tasks: [
    { id, title: "Scene", number: 1, topUpRequested: false, assignees: [{ userId: "creator" }] },
  ],
  items: [row],
  nextCursor: null,
};

const input = {
  taskId: id,
  beneficiaryUserId: "creator",
  points: 20,
  remainingWorkload: 1.5,
  workloadUnit: "hours" as const,
  reason: " Render ",
  requestKey: next,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockResolvedValue(page);
  vi.mocked(api.post).mockResolvedValue(row);
});
it("reads scoped requests and preserves exact usage", async () => {
  const result = await fetchCompute("crew", "user", null, new AbortController().signal);
  expect(result.consumedPoints).toBe("9007199254740993");
  expect(api.get).toHaveBeenCalledWith(
    "/crews/crew/compute-requests",
    expect.objectContaining({ service: "aurora" })
  );
});
it.each([{ crewId: "other" }, { userId: "other" }])(
  "rejects unauthorized row %j",
  async (change) => {
    vi.mocked(api.get).mockResolvedValue({
      ...page,
      isOwner: false,
      items: [{ ...row, ...change }],
    });
    await expect(fetchCompute("crew", "user", null, new AbortController().signal)).rejects.toThrow(
      "scope"
    );
  }
);
it("accepts other applicants only in owner scope", async () => {
  vi.mocked(api.get).mockResolvedValue({
    ...page,
    isOwner: true,
    items: [{ ...row, userId: "other" }],
  });
  await expect(
    fetchCompute("crew", "user", null, new AbortController().signal)
  ).resolves.toMatchObject({ isOwner: true });
});
it.each([{ items: [row, row] }, { nextCursor: next }, { consumedPoints: "1.2" }])(
  "rejects malformed page %j",
  async (change) => {
    vi.mocked(api.get).mockResolvedValue({ ...page, ...change });
    await expect(
      fetchCompute("crew", "user", next, new AbortController().signal)
    ).rejects.toThrow();
  }
);
it("submits normalized request key and permits already decided retry receipt", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...row, status: "approved" });
  await createCompute("crew", "user", input, 1);
  expect(api.post).toHaveBeenCalledExactlyOnceWith("/crews/crew/compute-requests", {
    service: "aurora",
    data: { ...input, reason: "Render" },
  });
});
it.each([0, 1.5, 501, 2000000001])("rejects invalid points %s", async (points) => {
  await expect(createCompute("crew", "user", { ...input, points }, 1)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { crewId: "other" },
  { userId: "other" },
  { taskId: next },
  { requestKey: id },
  { points: 21 },
  { reason: "Other" },
  { requestedByUserId: "other" },
  { remainingWorkload: "1.6" },
  { workloadUnit: "days" },
])("rejects mismatched receipt %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...row, ...change });
  await expect(createCompute("crew", "user", input, 1)).rejects.toThrow("receipt");
});
it("rejects stale session before and after request", async () => {
  h.generation = 2;
  await expect(createCompute("crew", "user", input, 1)).rejects.toThrow("session");
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return row;
  });
  await expect(createCompute("crew", "user", input, 1)).rejects.toThrow("session");
});

it.each([
  { remainingWorkload: 0 },
  { remainingWorkload: 1.001 },
  { remainingWorkload: 101, workloadUnit: "percent" as const },
])("rejects invalid workload %j before posting", async (change) => {
  await expect(createCompute("crew", "user", { ...input, ...change }, 1)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
