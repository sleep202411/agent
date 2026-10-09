import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCompute, createCompute, setupComputeWorkspace } from "./crew-compute-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111",
  next = "22222222-2222-4222-8222-222222222222";
const row = {
  id,
  crewId: "crew",
  userId: "user",
  taskId: id,
  taskTitle: "Scene",
  points: 20,
  reason: "Render",
  status: "pending",
  createdAt: "2026-09-30T00:00:00Z",
  decidedByAdminId: null,
  decidedByUserId: null,
  decisionNote: null,
  requestKey: id,
};
const page = {
  isOwner: false,
  consumedPoints: "9007199254740993",
  totals: { pending: 20 },
  tasks: [{ id, title: "Scene", number: 1 }],
  items: [row],
  nextCursor: null,
};

const input = { taskId: id, points: 20, reason: " Render ", requestKey: id };
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
    vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...row, ...change }] });
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
it.each([0, 1.5, 2000000001])("rejects invalid points %s", async (points) => {
  await expect(createCompute("crew", "user", { ...input, points }, 1)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { crewId: "other" },
  { userId: "other" },
  { taskId: next },
  { requestKey: next },
  { points: 21 },
  { reason: "Other" },
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

it("validates the selected recipient rather than confusing them with the owner", async () => {
  await expect(
    createCompute("crew", "owner", { ...input, beneficiaryUserId: "user" }, 1)
  ).resolves.toMatchObject({ userId: "user" });
  vi.mocked(api.post).mockResolvedValue({ ...row, userId: "owner" });
  await expect(
    createCompute("crew", "owner", { ...input, beneficiaryUserId: "user" }, 1)
  ).rejects.toThrow("receipt");
});
it("sets up a workspace only in the current session and validates the receipt", async () => {
  vi.mocked(api.post).mockResolvedValue({ workspaceId: id });
  await expect(setupComputeWorkspace("crew", 1)).resolves.toEqual({ workspaceId: id });
  h.generation = 2;
  await expect(setupComputeWorkspace("crew", 1)).rejects.toThrow("expired");
  expect(api.post).toHaveBeenCalledTimes(1);
});
