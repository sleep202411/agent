import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchProposalContext,
  proposalMinor,
  proposeApplicationTerms,
  termsProposal,
  type TermsProposal,
} from "./terms-proposal-api";
import type { ReviewApplication } from "./application-review-api";
const h = vi.hoisted(() => ({ generation: 1, cn: false }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
export const app: ReviewApplication = {
  id: "app",
  crewId: "crew",
  positionId: "position",
  applicantId: "creator",
  message: null,
  portfolioUrl: null,
  expectedCompensation: null,
  availableStartDate: null,
  yearsExperience: null,
  status: "pending",
  createdAt: "2026-10-01T00:00:00Z",
  reviewedAt: null,
  reviewerId: null,
};
const data: TermsProposal = {
  expectedVersion: 2,
  scope: "Storyboards",
  feeAmount: "9999999999999999",
  currency: "USD",
  feePeriod: "episode",
  revenueShareBp: 250,
  shareBasis: "Net receipts",
};
const receipt = {
  id: "00000000-0000-4000-8000-000000000001",
  applicationId: "app",
  version: 3,
  ...data,
  proposedByUserId: "manager",
  createdAt: app.createdAt,
  confirmedAt: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.post).mockResolvedValue(receipt);
});
it.each([
  ["0", "0"],
  ["0.01", "1"],
  ["99999999999999.99", "9999999999999999"],
  [" 1.2 ", "120"],
  ["01", null],
  ["1e3", null],
  ["-1", null],
  ["1.001", null],
  ["100000000000000", null],
])("converts %s exactly", (input, result) => {
  expect(proposalMinor(input!)).toBe(result);
});
it("requires scope and explicit basis for nonzero share", () => {
  expect(termsProposal.safeParse({ ...data, scope: " " }).success).toBe(false);
  expect(termsProposal.safeParse({ ...data, shareBasis: null }).success).toBe(false);
  expect(termsProposal.safeParse({ ...data, revenueShareBp: 5001 }).success).toBe(false);
});
it("posts the captured version and exact minor units", async () => {
  await proposeApplicationTerms(app, false, data, "manager", 1);
  expect(api.post).toHaveBeenCalledWith("/applications/app/terms", { service: "aurora", data });
});
it("recovers the identical proposal even if the applicant has since confirmed it", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("Network"))
    .mockResolvedValue({ ...receipt, confirmedAt: app.createdAt });
  await expect(proposeApplicationTerms(app, false, data, "manager", 1)).rejects.toThrow("Network");
  await proposeApplicationTerms(app, false, data, "manager", 1);
  expect(vi.mocked(api.post).mock.calls[0]).toEqual(vi.mocked(api.post).mock.calls[1]);
});
it.each([
  { version: 4 },
  { applicationId: "other" },
  { proposedByUserId: "other" },
  { feeAmount: "1" },
  { currency: "CNY" },
  { feePeriod: "month" },
  { scope: "Other" },
  { revenueShareBp: 500 },
  { shareBasis: "Gross" },
])("rejects altered receipts", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...receipt, ...change });
  await expect(proposeApplicationTerms(app, false, data, "manager", 1)).rejects.toThrow();
});
it("rejects self proposals, closed applications and wrong site currency before writes", async () => {
  await expect(proposeApplicationTerms(app, false, data, "creator", 1)).rejects.toThrow();
  await expect(
    proposeApplicationTerms({ ...app, status: "approved" }, false, data, "manager", 1)
  ).rejects.toThrow();
  await expect(
    proposeApplicationTerms(app, false, { ...data, currency: "CNY" }, "manager", 1)
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("requires bounded project fees for task recruitment", async () => {
  await expect(
    proposeApplicationTerms(app, true, { ...data, feeAmount: "100" }, "manager", 1)
  ).rejects.toThrow();
  await expect(
    proposeApplicationTerms(app, true, { ...data, feePeriod: "project" }, "manager", 1)
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects stale accounts before and after requests", async () => {
  h.generation = 2;
  await expect(proposeApplicationTerms(app, false, data, "manager", 1)).rejects.toThrow(
    "session expired"
  );
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return receipt;
  });
  await expect(proposeApplicationTerms(app, false, data, "manager", 1)).rejects.toThrow(
    "session expired"
  );
});
function contextMock(pages: unknown[], taskId: string | null = null) {
  let index = 0;
  vi.mocked(api.get).mockImplementation(async (path) => {
    if (path.endsWith("/positions")) return pages[index++];
    if (path.endsWith("/terms")) return { currentVersion: 0, items: [], nextBeforeVersion: null };
    if (path.endsWith("/interview"))
      return {
        applicationStatus: "pending",
        canUpdate: true,
        canMessage: true,
        version: 0,
        state: "not_started",
        scheduledAt: null,
        items: [],
        nextBeforeVersion: null,
      };
    return { ...app, taskId };
  });
}
it("resolves task linkage beyond the first position page", async () => {
  contextMock(
    [
      { items: [{ id: "first", crewId: "crew", taskId: null }], nextCursor: "first" },
      {
        items: [{ id: "position", crewId: "crew", taskId: "00000000-0000-4000-8000-000000000002" }],
        nextCursor: null,
      },
    ],
    "00000000-0000-4000-8000-000000000002"
  );
  expect(
    (await fetchProposalContext("crew", "app", 1, new AbortController().signal)).taskLinked
  ).toBe(true);
  expect(api.get).toHaveBeenLastCalledWith(
    "/crews/crew/positions",
    expect.objectContaining({ params: { limit: 100, cursor: "first" } })
  );
});
it.each(
  [
    [{ items: [{ id: "position", crewId: "other", taskId: null }], nextCursor: null }],
    [{ items: [], nextCursor: null }],
    [
      { items: [{ id: "first", crewId: "crew", taskId: null }], nextCursor: "first" },
      { items: [{ id: "first", crewId: "crew", taskId: null }], nextCursor: "first" },
    ],
  ].map((pages) => ({ pages }))
)("rejects missing, foreign or looping position context", async ({ pages }) => {
  contextMock(pages);
  await expect(
    fetchProposalContext("crew", "app", 1, new AbortController().signal)
  ).rejects.toThrow();
});

it("verifies payment terms in proposal receipts", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...receipt, paymentTerms: "monthly" });
  await expect(
    proposeApplicationTerms(app, false, { ...data, paymentTerms: "half_upfront" }, "manager", 1)
  ).rejects.toThrow("could not be verified");
});
