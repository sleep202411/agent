import { beforeEach, expect, it, vi } from "vitest";
import { fetchLifecyclePosition, changePositionLifecycle } from "./position-lifecycle-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, patch: h.patch, delete: h.delete } }));
const row = {
  id: "position",
  crewId: "crew",
  taskId: null,
  positionType: "director",
  status: "open" as const,
  targetCount: 2,
  recruitedCount: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.get.mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { userId: "manager", permissions: ["openings.manage"] }
      : { items: [row], nextCursor: null }
  );
  h.patch.mockResolvedValue({ ...row, status: "frozen" });
  h.delete.mockResolvedValue(undefined);
});
it("reads later pages in manager scope", async () => {
  h.get.mockImplementation(async (path, config) =>
    path.endsWith("members/me")
      ? { userId: "manager", permissions: ["openings.manage"] }
      : config.params.cursor
        ? { items: [row], nextCursor: null }
        : { items: [{ ...row, id: "previous" }], nextCursor: "previous" }
  );
  expect(await fetchLifecyclePosition(row, "manager", 1, new AbortController().signal)).toEqual(
    row
  );
});
it("freezes with only a status patch", async () => {
  await changePositionLifecycle(row, "manager", 1, "freeze");
  expect(h.patch).toHaveBeenCalledWith("/crews/crew/positions/position", {
    service: "aurora",
    data: { status: "frozen" },
  });
});
it("reopens frozen positions", async () => {
  const frozen = { ...row, status: "frozen" as const };
  h.get
    .mockResolvedValueOnce({ userId: "manager", permissions: ["openings.manage"] })
    .mockResolvedValueOnce({ items: [frozen], nextCursor: null });
  h.patch.mockResolvedValue(row);
  await changePositionLifecycle(frozen, "manager", 1, "reopen");
  expect(h.patch.mock.calls[0][1].data).toEqual({ status: "open" });
});
it("deletes the scoped position", async () => {
  await changePositionLifecycle(row, "manager", 1, "remove");
  expect(h.delete).toHaveBeenCalledWith("/crews/crew/positions/position", { service: "aurora" });
});
it("preserves pending application rejection without retry", async () => {
  h.delete.mockRejectedValue(new Error("Cannot delete position with pending applications"));
  await expect(changePositionLifecycle(row, "manager", 1, "remove")).rejects.toThrow(
    "pending applications"
  );
  expect(h.delete).toHaveBeenCalledTimes(1);
});
it.each([
  { userId: "other", permissions: ["openings.manage"] },
  { userId: "manager", permissions: [] },
])("rejects invalid authorization", async (member) => {
  h.get.mockResolvedValue(member);
  await expect(changePositionLifecycle(row, "manager", 1, "remove")).rejects.toThrow();
  expect(h.delete).not.toHaveBeenCalled();
});
it.each([{ status: "frozen" }, { targetCount: 3 }, { recruitedCount: 1 }])(
  "requires review after changes",
  async (change) => {
    h.get
      .mockResolvedValueOnce({ userId: "manager", permissions: ["openings.manage"] })
      .mockResolvedValueOnce({ items: [{ ...row, ...change }], nextCursor: null });
    await expect(changePositionLifecycle(row, "manager", 1, "freeze")).rejects.toThrow("changed");
    expect(h.patch).not.toHaveBeenCalled();
  }
);
it("rejects missing position", async () => {
  h.get
    .mockResolvedValueOnce({ userId: "manager", permissions: ["openings.manage"] })
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  await expect(changePositionLifecycle(row, "manager", 1, "remove")).rejects.toThrow(
    "no longer available"
  );
  expect(h.delete).not.toHaveBeenCalled();
});
it.each([{ id: "wrong" }, { crewId: "wrong" }, { status: "open" }])(
  "rejects mismatched receipt",
  async (change) => {
    h.patch.mockResolvedValue({ ...row, status: "frozen", ...change });
    await expect(changePositionLifecycle(row, "manager", 1, "freeze")).rejects.toThrow("verified");
  }
);
it("does not retry uncertain patches", async () => {
  h.patch.mockRejectedValue(new Error("offline"));
  await expect(changePositionLifecycle(row, "manager", 1, "freeze")).rejects.toThrow("offline");
  expect(h.patch).toHaveBeenCalledTimes(1);
});
it("rejects stale account before read", async () => {
  h.generation = 2;
  await expect(changePositionLifecycle(row, "manager", 1, "remove")).rejects.toThrow("expired");
  expect(h.get).not.toHaveBeenCalled();
});
it("rejects account changes after deletion", async () => {
  h.delete.mockImplementation(async () => {
    h.generation = 2;
  });
  await expect(changePositionLifecycle(row, "manager", 1, "remove")).rejects.toThrow("expired");
});
