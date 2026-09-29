import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  amendmentProposal,
  fetchApplicationAmendments,
  fetchAmendmentContext,
  proposeAmendment,
  decideAmendment,
  type ApplicationAmendment,
} from "./application-amendments-api";
const h = vi.hoisted(() => ({ generation: 1, context: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
vi.mock("./terms-proposal-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchProposalContext: h.context,
}));
const amendmentId = "00000000-0000-4000-8000-000000000001",
  taskId = "00000000-0000-4000-8000-000000000002";
const scope = { applicationId: "app", applicantId: "creator", taskId };
const proposal = {
  id: amendmentId,
  expectedVersion: 2,
  expectedTaskVersion: 4,
  scope: "Shots",
  feeAmount: "12345",
  currency: "CNY" as const,
  feePeriod: "project" as const,
  revenueShareBp: 250,
  shareBasis: "Net receipts",
  reason: "Additional shots",
};
const row: ApplicationAmendment = {
  id: amendmentId,
  ...scope,
  proposedByUserId: "manager",
  proposal,
  status: "pending",
  confirmedAt: null,
  settledAt: null,
  settledByUserId: null,
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.post).mockResolvedValue(row);
});
it("preserves the historical obligation currency even on another site", async () => {
  await proposeAmendment(scope, proposal, "manager", 1);
  expect(api.post).toHaveBeenCalledWith("/applications/app/amendments", {
    service: "aurora",
    data: amendmentProposal.parse(proposal),
  });
});
it.each([
  { expectedTaskVersion: 0 },
  { feeAmount: "bad" },
  { feeAmount: "-1" },
  { reason: "x" },
  { feePeriod: "month" },
  { feeAmount: "10000000001" },
  { revenueShareBp: 5001 },
  { shareBasis: null },
])("validates amendment constraints", (change) =>
  expect(amendmentProposal.safeParse({ ...proposal, ...change }).success).toBe(false)
);
it("retries exact proposal UUID and payload after response loss", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Network"));
  await expect(proposeAmendment(scope, proposal, "manager", 1)).rejects.toThrow("Network");
  await proposeAmendment(scope, proposal, "manager", 1);
  expect(vi.mocked(api.post).mock.calls[1]).toEqual(vi.mocked(api.post).mock.calls[0]);
});
it.each([
  { applicationId: "other" },
  { taskId: "00000000-0000-4000-8000-000000000003" },
  { applicantId: "other" },
  { proposedByUserId: "other" },
  { proposal: { ...proposal, feeAmount: "1" } },
])("rejects foreign or changed proposal receipts", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...row, ...change });
  await expect(proposeAmendment(scope, proposal, "manager", 1)).rejects.toThrow();
});
it.each(["effective", "awaiting_settlement", "settlement_requested"] as const)(
  "accepts server-owned consent outcome %s",
  async (status) => {
    vi.mocked(api.post).mockResolvedValue({ ...row, status, confirmedAt: "2026-10-01T00:00:00Z" });
    expect((await decideAmendment(row, "creator", 1, "confirm")).status).toBe(status);
    expect(api.post).toHaveBeenCalledWith(`/applications/app/amendments/${amendmentId}/decision`, {
      service: "aurora",
      data: { action: "confirm" },
    });
  }
);
it("permits rejecting creator-confirmed amendments awaiting settlement", async () => {
  const waiting = {
    ...row,
    status: "awaiting_settlement" as const,
    confirmedAt: "2026-10-01T00:00:00Z",
  };
  vi.mocked(api.post).mockResolvedValue({ ...waiting, status: "rejected" });
  await decideAmendment(waiting, "creator", 1, "reject");
});
it("restricts consent and withdrawal to the correct actors", async () => {
  await expect(decideAmendment(row, "manager", 1, "confirm")).rejects.toThrow();
  await expect(decideAmendment(row, "creator", 1, "withdraw")).rejects.toThrow();
  await expect(proposeAmendment(scope, proposal, "creator", 1)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("withdraws only the exact original proposal", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...row, status: "withdrawn" });
  await decideAmendment(row, "manager", 1, "withdraw");
  vi.mocked(api.post).mockResolvedValue({
    ...row,
    status: "withdrawn",
    proposal: { ...proposal, scope: "Other" },
  });
  await expect(decideAmendment(row, "manager", 1, "withdraw")).rejects.toThrow();
});
it("blocks stale accounts and late responses", async () => {
  h.generation = 2;
  await expect(proposeAmendment(scope, proposal, "manager", 1)).rejects.toThrow("session expired");
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return { ...row, status: "effective", confirmedAt: "2026-10-01T00:00:00Z" };
  });
  await expect(decideAmendment(row, "creator", 1, "confirm")).rejects.toThrow("session expired");
});
it("reads scoped history using the server cursor", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [row], nextCursor: row.id });
  expect((await fetchApplicationAmendments(scope, null, 1, signal())).items[0]?.id).toBe(row.id);
});
it.each([
  { items: [{ ...row, applicantId: "other" }], nextCursor: null },
  { items: [row, row], nextCursor: null },
  { items: [row], nextCursor: taskId },
  { items: [{ ...row, status: "effective" }], nextCursor: null },
])("rejects invalid history", async (page) => {
  vi.mocked(api.get).mockResolvedValue(page);
  await expect(fetchApplicationAmendments(scope, null, 1, signal())).rejects.toThrow();
});
it("keeps reviewer-only permissions and task reads out of applicant access", async () => {
  vi.mocked(api.get).mockResolvedValue({ currentVersion: 0, items: [], nextBeforeVersion: null });
  const ctx = await fetchAmendmentContext(
    "crew",
    "app",
    "creator",
    taskId,
    "creator",
    false,
    1,
    signal()
  );
  expect(ctx.canPropose).toBe(false);
  expect(h.context).not.toHaveBeenCalled();
  expect(api.get).toHaveBeenCalledTimes(1);
});
it("requires both reviewer permissions and validates task scope", async () => {
  h.context.mockResolvedValue({
    app: { status: "approved", applicantId: "creator" },
    taskId,
    terms: { currentVersion: 2, items: [], nextBeforeVersion: null },
  });
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/members/me")
      ? { userId: "manager", permissions: ["applications.review", "tasks.manage"] }
      : { id: taskId, crewId: "crew", version: 4 }
  );
  const ctx = await fetchAmendmentContext(
    "crew",
    "app",
    "creator",
    undefined,
    "manager",
    true,
    1,
    signal()
  );
  expect(ctx.canPropose).toBe(true);
  expect(ctx.taskVersion).toBe(4);
  vi.mocked(api.get).mockResolvedValue({ userId: "manager", permissions: ["applications.review"] });
  expect(
    (await fetchAmendmentContext("crew", "app", "creator", undefined, "manager", true, 1, signal()))
      .canPropose
  ).toBe(false);
});
