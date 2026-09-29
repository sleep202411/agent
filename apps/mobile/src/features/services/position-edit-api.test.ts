import { beforeEach, expect, it, vi } from "vitest";
import {
  editPosition,
  fetchEditablePosition,
  positionDraft,
  type EditablePosition,
} from "./position-edit-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, patch: h.patch } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
const row: EditablePosition = {
  id: "position",
  crewId: "crew",
  taskId: null,
  recruitmentVisibility: "public",
  positionType: "custom old role",
  description: "Original",
  targetCount: 3,
  recruitedCount: 1,
  status: "frozen",
  workMode: "remote",
  location: null,
  employmentType: "project_based",
  experienceLevel: "any",
  requiredSkills: [],
  salary: {
    currency: "USD",
    period: "project",
    minAmount: 1234,
    maxAmount: 5000,
    negotiable: false,
  },
  durationMonths: null,
  revenueSharePercent: null,
  closeDate: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockImplementation(async (path) =>
    path.endsWith("members/me")
      ? { userId: "manager", permissions: ["openings.manage"] }
      : { items: [row], nextCursor: null }
  );
  h.patch.mockImplementation(async (_path, { data }) => ({ ...row, ...data }));
});
it("sends only changed fields and preserves immutable links and status", async () => {
  await editPosition(row, "manager", 1, { ...positionDraft(row), description: "Updated" });
  expect(h.patch).toHaveBeenCalledWith("/crews/crew/positions/position", {
    service: "aurora",
    data: { description: "Updated" },
  });
});
it("converts display salary to verified minor-unit receipt", async () => {
  const draft = positionDraft(row);
  draft.salary.min = 25.75;
  h.patch.mockResolvedValue({ ...row, salary: { ...row.salary, minAmount: 2575 } });
  await editPosition(row, "manager", 1, draft);
  expect(h.patch.mock.calls[0][1].data.salary.min).toBe(25.75);
});
it("does not overwrite legacy null salary fields on unrelated edits", async () => {
  const original = {
    ...row,
    salary: { currency: null, period: null, minAmount: null, maxAmount: null, negotiable: true },
  };
  h.get
    .mockResolvedValueOnce({ userId: "manager", permissions: ["openings.manage"] })
    .mockResolvedValueOnce({ items: [original], nextCursor: null });
  h.patch.mockResolvedValue({ ...original, description: "Updated" });
  await editPosition(original, "manager", 1, {
    ...positionDraft(original),
    description: "Updated",
  });
  expect(h.patch.mock.calls[0][1].data).toEqual({ description: "Updated" });
});
it("converts JPY with no fractional unit", () => {
  expect(
    positionDraft({ ...row, salary: { ...row.salary, currency: "JPY", minAmount: 1234 } }).salary
      .min
  ).toBe(1234);
});
it.each([
  { positionType: "director" },
  { taskId: "00000000-0000-4000-8000-000000000001" },
  { recruitmentVisibility: "private" as const },
  { targetCount: 0 },
])("rejects invalid/immutable edits", async (changes) => {
  await expect(
    editPosition(row, "manager", 1, { ...positionDraft(row), ...changes })
  ).rejects.toThrow();
  expect(h.patch).not.toHaveBeenCalled();
});
it("rejects capacity below recruited count", async () => {
  const baseline = { ...row, recruitedCount: 2 };
  await expect(
    editPosition(baseline, "manager", 1, { ...positionDraft(baseline), targetCount: 1 })
  ).rejects.toThrow("recruited");
});
it("rejects unchanged draft", async () => {
  await expect(editPosition(row, "manager", 1, positionDraft(row))).rejects.toThrow(
    "No position changes"
  );
  expect(h.patch).not.toHaveBeenCalled();
});
it("rejects fresh server changes before write", async () => {
  h.get
    .mockResolvedValueOnce({ userId: "manager", permissions: ["openings.manage"] })
    .mockResolvedValueOnce({
      items: [{ ...row, description: "Other manager edit" }],
      nextCursor: null,
    });
  await expect(
    editPosition(row, "manager", 1, { ...positionDraft(row), description: "Updated" })
  ).rejects.toThrow("changed");
  expect(h.patch).not.toHaveBeenCalled();
});
it.each([{ id: "wrong" }, { crewId: "wrong" }, { description: "wrong" }])(
  "rejects receipt mismatch",
  async (change) => {
    h.patch.mockResolvedValue({ ...row, description: "Updated", ...change });
    await expect(
      editPosition(row, "manager", 1, { ...positionDraft(row), description: "Updated" })
    ).rejects.toThrow("verified");
  }
);
it("rejects permission loss", async () => {
  h.get.mockResolvedValue({ userId: "manager", permissions: [] });
  await expect(
    editPosition(row, "manager", 1, { ...positionDraft(row), description: "Updated" })
  ).rejects.toThrow("permission");
  expect(h.patch).not.toHaveBeenCalled();
});
it("rejects stale account after response", async () => {
  h.patch.mockImplementation(async () => {
    h.generation = 2;
    return { ...row, description: "Updated" };
  });
  await expect(
    editPosition(row, "manager", 1, { ...positionDraft(row), description: "Updated" })
  ).rejects.toThrow("expired");
});
it("does not retry uncertain writes", async () => {
  h.patch.mockRejectedValue(new Error("offline"));
  await expect(
    editPosition(row, "manager", 1, { ...positionDraft(row), description: "Updated" })
  ).rejects.toThrow("offline");
  expect(h.patch).toHaveBeenCalledTimes(1);
});
it("follows pagination and rejects foreign rows", async () => {
  h.get.mockImplementation(async (path, c) =>
    path.endsWith("members/me")
      ? { userId: "manager", permissions: ["openings.manage"] }
      : c.params.cursor
        ? { items: [row], nextCursor: null }
        : { items: [{ ...row, id: "earlier" }], nextCursor: "earlier" }
  );
  expect(await fetchEditablePosition("crew", "position", "manager", 1)).toEqual(row);
  h.get
    .mockResolvedValueOnce({ userId: "manager", permissions: ["openings.manage"] })
    .mockResolvedValueOnce({ items: [{ ...row, crewId: "other" }], nextCursor: null });
  await expect(fetchEditablePosition("crew", "position", "manager", 1)).rejects.toThrow("changed");
});
