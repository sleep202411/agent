import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchAmendmentAccess,
  fetchAmendments,
  settleAmendment,
  type Amendment,
} from "./amendment-finance-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "00000000-0000-4000-8000-000000000001";
const row: Amendment = {
  id,
  applicationId: "application",
  taskId: id,
  proposedByUserId: "producer",
  applicantId: "creator",
  proposal: {
    id,
    expectedVersion: 2,
    expectedTaskVersion: 3,
    scope: "Revised shots",
    feeAmount: "12345",
    currency: "USD",
    feePeriod: "project",
    revenueShareBp: 250,
    shareBasis: "Net receipts",
    reason: "Additional approved shots",
  },
  status: "awaiting_settlement",
  confirmedAt: "2026-09-30T00:00:00Z",
  settledByUserId: null,
  settledAt: null,
};
const receipt = {
  ...row,
  status: "effective",
  settledAt: "2026-09-30T01:00:00Z",
  settledByUserId: "finance",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.post).mockResolvedValue(receipt);
});
it("requires earnings approval rather than ledger viewing", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "finance", permissions: ["finance.ledger.view"] });
  expect(await fetchAmendmentAccess("crew", "finance", signal())).toBe(false);
  vi.mocked(api.get).mockResolvedValue({
    userId: "finance",
    permissions: ["finance.earnings.approve"],
  });
  expect(await fetchAmendmentAccess("crew", "finance", signal())).toBe(true);
});
it("rejects another account's membership", async () => {
  vi.mocked(api.get).mockResolvedValue({
    userId: "other",
    permissions: ["finance.earnings.approve"],
  });
  await expect(fetchAmendmentAccess("crew", "finance", signal())).rejects.toThrow(
    "account mismatch"
  );
});
it("reads a scoped filtered queue with cursor", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [row], nextCursor: null });
  expect((await fetchAmendments("crew", "awaiting_settlement", id, signal())).items).toEqual([row]);
  expect(api.get).toHaveBeenCalledWith(
    "/crews/crew/application-amendments",
    expect.objectContaining({
      service: "aurora",
      params: { status: "awaiting_settlement", limit: 20, cursor: id },
    })
  );
});
it.each([
  { items: [{ ...row, confirmedAt: null }], nextCursor: null },
  { items: [{ ...row, status: "effective" }], nextCursor: null },
  { items: [row, row], nextCursor: null },
  { items: [row], nextCursor: id },
  {
    items: [{ ...row, proposal: { ...row.proposal, id: "00000000-0000-4000-8000-000000000002" } }],
    nextCursor: null,
  },
])("rejects inconsistent queue %j", async (page) => {
  vi.mocked(api.get).mockResolvedValue(page);
  await expect(fetchAmendments("crew", "awaiting_settlement", id, signal())).rejects.toThrow();
});
it.each(["effective", "settlement_requested"])(
  "accepts the server's %s outcome",
  async (status) => {
    vi.mocked(api.post).mockResolvedValue({ ...receipt, status });
    expect((await settleAmendment(row, 1)).status).toBe(status);
    expect(api.post).toHaveBeenCalledWith(`/applications/application/amendments/${id}/settle`, {
      service: "aurora",
    });
  }
);
it("retries the exact amendment after an uncertain response", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Network error"));
  await expect(settleAmendment(row, 1)).rejects.toThrow("Network error");
  expect(await settleAmendment(row, 1)).toEqual(receipt);
  expect(vi.mocked(api.post).mock.calls[0]).toEqual(vi.mocked(api.post).mock.calls[1]);
});
it.each([
  { applicationId: "other" },
  { taskId: "00000000-0000-4000-8000-000000000002" },
  { proposal: { ...row.proposal, feeAmount: "999" } },
  { settledAt: null },
  { status: "awaiting_settlement" },
  { confirmedAt: "2026-09-29T00:00:00Z" },
])("rejects mismatched receipt %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...receipt, ...change });
  await expect(settleAmendment(row, 1)).rejects.toThrow();
});
it("does not post unconfirmed or already settled records", async () => {
  await expect(settleAmendment({ ...row, confirmedAt: null }, 1)).rejects.toThrow();
  await expect(settleAmendment({ ...row, settledAt: receipt.settledAt }, 1)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("does not write across an account change", async () => {
  h.generation = 2;
  await expect(settleAmendment(row, 1)).rejects.toThrow("session expired");
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects a result arriving after account change", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return receipt;
  });
  await expect(settleAmendment(row, 1)).rejects.toThrow("session expired");
});
