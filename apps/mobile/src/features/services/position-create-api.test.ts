import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  createPosition,
  fetchPositionCreateAccess,
  newPosition,
  positionAmount,
  type NewPosition,
} from "./position-create-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
const input: NewPosition = {
  positionType: "director",
  description: "Direct the film",
  targetCount: 2,
  workMode: "remote",
  location: null,
  employmentType: "project_based",
  experienceLevel: "mid",
  requiredSkills: ["Editing"],
  salary: { period: "project", currency: "USD", min: 12.34, max: 50, negotiable: false },
  durationMonths: null,
  revenueSharePercent: 2.5,
  closeDate: "2028-02-29",
  recruitmentVisibility: "public",
};
const result = {
  ...input,
  id: "position",
  crewId: "crew",
  taskId: null,
  recruitedCount: 0,
  status: "open",
  salary: {
    period: "project",
    currency: "USD",
    minAmount: 1234,
    maxAmount: 5000,
    negotiable: false,
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.get).mockResolvedValue({
    userId: "manager",
    permissions: ["openings.manage", "tasks.manage", "tasks.view"],
  });
  vi.mocked(api.post).mockResolvedValue(result);
});
it("creates using display units and verifies returned minor units", async () => {
  await createPosition("crew", "manager", 1, input);
  expect(api.post).toHaveBeenCalledWith("/crews/crew/positions", {
    service: "aurora",
    data: input,
  });
});
it("rechecks current management access before creating", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "manager", permissions: [] });
  await expect(createPosition("crew", "manager", 1, input)).rejects.toThrow("permission");
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects foreign membership and task-link permissions", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "other", permissions: ["openings.manage"] });
  await expect(fetchPositionCreateAccess("crew", "manager", 1)).rejects.toThrow();
  vi.mocked(api.get).mockResolvedValue({ userId: "manager", permissions: ["openings.manage"] });
  await expect(
    createPosition("crew", "manager", 1, {
      ...input,
      taskId: "00000000-0000-4000-8000-000000000001",
    })
  ).rejects.toThrow("Task management");
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { description: "" },
  { targetCount: 0 },
  { targetCount: 100 },
  { workMode: "onsite", location: null },
  { recruitmentVisibility: "private" },
  { durationMonths: 61 },
  { revenueSharePercent: 0.25 },
  { closeDate: "2026-02-30" },
  { closeDate: "2026-2-01" },
  { requiredSkills: Array(21).fill("x") },
  { positionType: "made-up" },
  { salary: { ...input.salary, min: 51, max: 50 } },
])("validates create contract", (change) =>
  expect(newPosition.safeParse({ ...input, ...change }).success).toBe(false)
);
it.each([
  ["12.34", "USD", 12.34],
  ["0", "JPY", 0],
  ["12", "JPY", 12],
  ["", "USD", null],
] as const)("parses salary %s %s", (v, c, result) => expect(positionAmount(v, c)).toBe(result));
it.each([
  ["12.34", "JPY"],
  ["1.001", "USD"],
  ["1e3", "USD"],
  ["100000000.01", "USD"],
  ["-1", "USD"],
] as const)("rejects precision/range errors %s %s", (v, c) =>
  expect(() => positionAmount(v, c)).toThrow()
);
it("accepts JPY receipts without multiplying by 100", async () => {
  const data = {
    ...input,
    salary: { ...input.salary, currency: "JPY" as const, min: 10, max: 20 },
  };
  vi.mocked(api.post).mockResolvedValue({
    ...result,
    salary: { period: "project", currency: "JPY", minAmount: 10, maxAmount: 20, negotiable: false },
  });
  await createPosition("crew", "manager", 1, data);
});
it.each([
  { crewId: "other" },
  { positionType: "editor" },
  { description: "Other" },
  { targetCount: 3 },
  { taskId: "00000000-0000-4000-8000-000000000001" },
  { salary: { ...result.salary, minAmount: 12.34 } },
  { requiredSkills: ["Other"] },
  { recruitmentVisibility: "private" },
])("rejects mismatched creation receipt", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...result, ...change });
  await expect(createPosition("crew", "manager", 1, input)).rejects.toThrow();
});
it("does not retry a creation after an ambiguous result", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Network"));
  await expect(createPosition("crew", "manager", 1, input)).rejects.toThrow("Network");
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("guards account changes before admission and after response", async () => {
  h.generation = 2;
  await expect(createPosition("crew", "manager", 1, input)).rejects.toThrow("session expired");
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return result;
  });
  await expect(createPosition("crew", "manager", 1, input)).rejects.toThrow("session expired");
});

it("accepts the complete official 10,000-character public brief without truncation", () => {
  expect(newPosition.parse({ ...input, description: "x".repeat(10000) }).description).toHaveLength(
    10000
  );
  expect(newPosition.safeParse({ ...input, description: "x".repeat(10001) }).success).toBe(false);
});

it("preserves selected payment terms and rejects a different receipt", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...result, paymentTerms: "monthly" });
  await expect(
    createPosition("crew", "manager", 1, { ...input, paymentTerms: "monthly" })
  ).resolves.toMatchObject({ paymentTerms: "monthly" });
  await expect(
    createPosition("crew", "manager", 1, { ...input, paymentTerms: "half_upfront" })
  ).rejects.toThrow("receipt mismatch");
});
