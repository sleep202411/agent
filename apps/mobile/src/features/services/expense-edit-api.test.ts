import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { expenseAmount, saveExpense } from "./expense-edit-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111",
  receipt = "22222222-2222-4222-8222-222222222222";
const definition = {
  category: "Travel",
  purpose: "Scouting",
  occurredOn: "2026-09-29",
  currency: "USD" as const,
  amountMinor: "12345",
  evidenceNote: "Train ticket",
  receiptIds: [receipt],
};
const row = {
  id,
  version: 2,
  crewId: "crew",
  claimantUserId: "user",
  definition,
  createdAt: "2026-09-30T00:00:00Z",
  submissionStatus: null,
  submittedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.post).mockResolvedValue(row);
});
it.each([
  ["", null],
  ["0", "0"],
  ["001.20", "120"],
  ["9999999999999.99", "999999999999999"],
])("parses exact expense amount %s", (value, expected) =>
  expect(expenseAmount(value!)).toBe(expected)
);
it.each(["-1", "1.001", "1e3", "10000000000000", "NaN"])("rejects invalid amount %s", (value) =>
  expect(() => expenseAmount(value)).toThrow()
);
it("saves expected revision with all receipt references and trimmed strings", async () => {
  await saveExpense(
    "crew",
    "user",
    id,
    { expectedVersion: 1, definition: { ...definition, category: " Travel " } },
    1
  );
  expect(api.post).toHaveBeenCalledExactlyOnceWith(`/crews/crew/expense-drafts/${id}`, {
    service: "aurora",
    data: { expectedVersion: 1, definition },
  });
});
it.each([
  { id: receipt },
  { version: 3 },
  { crewId: "other" },
  { claimantUserId: "other" },
  { definition: { ...definition, receiptIds: [] } },
])("rejects mismatched save receipt %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...row, ...change });
  await expect(
    saveExpense("crew", "user", id, { expectedVersion: 1, definition }, 1)
  ).rejects.toThrow("receipt");
});
it("does not post invalid dates", async () => {
  await expect(
    saveExpense(
      "crew",
      "user",
      id,
      { expectedVersion: 1, definition: { ...definition, occurredOn: "2026-02-30" } },
      1
    )
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("preserves conflict error", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Draft changed. Refresh before saving."));
  await expect(
    saveExpense("crew", "user", id, { expectedVersion: 1, definition }, 1)
  ).rejects.toThrow("Draft changed");
});
it("rejects stale account before and after save", async () => {
  h.generation = 2;
  await expect(
    saveExpense("crew", "user", id, { expectedVersion: 1, definition }, 1)
  ).rejects.toThrow("session");
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return row;
  });
  await expect(
    saveExpense("crew", "user", id, { expectedVersion: 1, definition }, 1)
  ).rejects.toThrow("session");
});
