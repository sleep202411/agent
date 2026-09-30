import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { canSubmitExpense, submitExpense } from "./expense-submit-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const record = {
  id,
  version: 2,
  crewId: "crew",
  claimantUserId: "user",
  definition: {
    category: "Travel",
    purpose: "Scouting",
    occurredOn: "2026-09-29",
    currency: "USD" as const,
    amountMinor: "12345",
    evidenceNote: "",
    receiptIds: [other],
  },
  createdAt: "2026-09-30T00:00:00Z",
  submissionStatus: null,
  submittedAt: null,
};
const receipt = {
  draftId: id,
  draftVersion: 2,
  status: "pending",
  submittedAt: "2026-09-30T00:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.post).mockResolvedValue(receipt);
});
it("submits only the saved version to the scoped endpoint", async () => {
  await expect(submitExpense(record, "user", 1)).resolves.toEqual(receipt);
  expect(api.post).toHaveBeenCalledExactlyOnceWith(`/crews/crew/expense-drafts/${id}/submit`, {
    service: "aurora",
    data: { expectedVersion: 2 },
  });
});
it.each([
  { category: "" },
  { purpose: " " },
  { occurredOn: null },
  { amountMinor: null },
  { amountMinor: "0" },
])("blocks incomplete claim %j", async (change) => {
  const row = { ...record, definition: { ...record.definition, ...change } };
  expect(canSubmitExpense(row)).toBe(false);
  await expect(submitExpense(row, "user", 1)).rejects.toThrow("Complete");
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["pending", "approved", "rejected"] as const)(
  "does not resubmit a displayed %s claim",
  async (status) => {
    await expect(
      submitExpense({ ...record, submissionStatus: status }, "user", 1)
    ).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  }
);
it("rejects another claimant", async () => {
  await expect(submitExpense(record, "other", 1)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["pending", "approved", "rejected"])(
  "accepts authoritative %s on an idempotent retry",
  async (status) => {
    vi.mocked(api.post).mockResolvedValue({ ...receipt, status });
    await expect(submitExpense(record, "user", 1)).resolves.toMatchObject({ status });
  }
);
it.each([{ draftId: other }, { draftVersion: 3 }])(
  "rejects mismatched receipt %j",
  async (change) => {
    vi.mocked(api.post).mockResolvedValue({ ...receipt, ...change });
    await expect(submitExpense(record, "user", 1)).rejects.toThrow("receipt");
  }
);
it("retains revision conflict details", async () => {
  vi.mocked(api.post).mockRejectedValue(
    new Error("Draft changed or is unavailable. Refresh before submitting.")
  );
  await expect(submitExpense(record, "user", 1)).rejects.toThrow("Draft changed");
});
it("rejects stale session before and after request", async () => {
  h.generation = 2;
  await expect(submitExpense(record, "user", 1)).rejects.toThrow("session");
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return receipt;
  });
  await expect(submitExpense(record, "user", 1)).rejects.toThrow("session");
});
