import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchExpenses, fetchExpenseHistory, fetchExpenseReceipt } from "./crew-expenses-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111",
  next = "22222222-2222-4222-8222-222222222222";
const row = {
  id,
  version: 2,
  crewId: "crew",
  claimantUserId: "user",
  definition: {
    category: "Travel",
    purpose: "Location scouting",
    occurredOn: "2026-09-29",
    currency: "USD",
    amountMinor: "12345",
    evidenceNote: "Train ticket",
    receiptIds: [next],
  },
  createdAt: "2026-09-30T00:00:00Z",
  submissionStatus: "pending",
  submittedAt: "2026-09-30T00:00:00Z",
};
const page = { items: [row], nextCursor: null };

const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue(page);
});
it("requests personal claims without imposing current membership", async () => {
  expect(await fetchExpenses("crew", "user", null, signal())).toEqual(page);
  expect(api.get).toHaveBeenCalledWith(
    "/crews/crew/expense-drafts",
    expect.objectContaining({ params: { limit: 30 }, service: "aurora" })
  );
});
it.each([{ crewId: "other" }, { claimantUserId: "other" }])(
  "rejects foreign claims %j",
  async (change) => {
    vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...row, ...change }] });
    await expect(fetchExpenses("crew", "user", null, signal())).rejects.toThrow("scope");
  }
);
it("rejects duplicate claims and repeated cursor", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [row, row] });
  await expect(fetchExpenses("crew", "user", null, signal())).rejects.toThrow();
  vi.mocked(api.get).mockResolvedValue({ ...page, nextCursor: next });
  await expect(fetchExpenses("crew", "user", next, signal())).rejects.toThrow();
});
it("requests older revisions and accepts exact history identity", async () => {
  await fetchExpenseHistory("crew", "user", id, 3, signal());
  expect(api.get).toHaveBeenCalledWith(
    `/crews/crew/expense-drafts/${id}/history`,
    expect.objectContaining({ params: { limit: 30, beforeVersion: 3 } })
  );
});
it.each([{ id: next }, { version: 3 }, { claimantUserId: "other" }, { crewId: "other" }])(
  "rejects invalid historical scope %j",
  async (change) => {
    vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...row, ...change }] });
    await expect(fetchExpenseHistory("crew", "user", id, 3, signal())).rejects.toThrow();
  }
);
it("rejects mismatched history cursor", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...page, nextCursor: 1 });
  await expect(fetchExpenseHistory("crew", "user", id, null, signal())).rejects.toThrow();
});
it.each(["http://example.com/file", "https://user:secret@example.com/file", "javascript:alert(1)"])(
  "rejects unsafe receipt link %s",
  async (url) => {
    vi.mocked(api.get).mockResolvedValue({ url });
    await expect(fetchExpenseReceipt("crew", id, next, signal())).rejects.toThrow();
  }
);
it("resolves authenticated receipt on demand", async () => {
  vi.mocked(api.get).mockResolvedValue({ url: "https://storage.example.com/signed" });
  await expect(fetchExpenseReceipt("crew", id, next, signal())).resolves.toBe(
    "https://storage.example.com/signed"
  );
  expect(api.get).toHaveBeenCalledWith(
    `/crews/crew/expense-drafts/${id}/receipts/${next}/read`,
    expect.objectContaining({ service: "aurora" })
  );
});
it("preserves server errors", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Receipt is unavailable"));
  await expect(fetchExpenseReceipt("crew", id, next, signal())).rejects.toThrow(
    "Receipt is unavailable"
  );
});
