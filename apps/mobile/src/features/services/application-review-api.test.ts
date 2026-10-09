import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchReviewApplications,
  fetchReviewApplication,
  canApproveReview,
  decideReviewApplication,
  type ReviewApplication,
} from "./application-review-api";
const h = vi.hoisted(() => ({ generation: 1, terms: vi.fn(), interview: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./application-terms-api", () => ({ fetchApplicationTerms: h.terms }));
vi.mock("./application-interview-api", () => ({ fetchApplicationInterview: h.interview }));
const app: ReviewApplication = {
  id: "app",
  crewId: "crew",
  positionId: "position",
  applicantId: "creator",
  message: "Hello",
  portfolioUrl: null,
  expectedCompensation: null,
  availableStartDate: null,
  yearsExperience: 2,
  status: "pending",
  createdAt: "2026-10-01T00:00:00Z",
  reviewedAt: null,
  reviewerId: null,
};
const result = {
  ...app,
  status: "approved",
  reviewedAt: "2026-10-01T01:00:00Z",
  reviewerId: "manager",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.terms.mockResolvedValue({ currentVersion: 0, items: [], nextBeforeVersion: null });
  h.interview.mockResolvedValue({ applicationStatus: "pending", state: "not_started", items: [] });
  vi.mocked(api.get).mockResolvedValue(app);
  vi.mocked(api.post).mockResolvedValue(result);
});
it("reads filtered reviewer inbox", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [app], nextCursor: null });
  expect((await fetchReviewApplications("crew", 1, "pending", null, signal())).items).toEqual([
    app,
  ]);
  expect(api.get).toHaveBeenCalledWith(
    "/crews/crew/applications",
    expect.objectContaining({ params: { limit: 20, status: "pending" } })
  );
});
it.each([{ crewId: "foreign" }, { status: "rejected" }])(
  "rejects wrong list scope %j",
  async (patch) => {
    vi.mocked(api.get).mockResolvedValue({ items: [{ ...app, ...patch }], nextCursor: null });
    await expect(fetchReviewApplications("crew", 1, "pending", null, signal())).rejects.toThrow();
  }
);
it("rejects duplicate records", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [app, app], nextCursor: null });
  await expect(fetchReviewApplications("crew", 1, "pending", null, signal())).rejects.toThrow();
});
it("reads fresh detail before terms and interview", async () => {
  const review = await fetchReviewApplication("crew", "app", 1, signal());
  expect(review.app).toEqual(app);
  expect(canApproveReview(review, "manager")).toBe(true);
  expect(canApproveReview(review, "creator")).toBe(false);
});
it("does not read private related data after foreign detail", async () => {
  vi.mocked(api.get).mockResolvedValue({ ...app, crewId: "other" });
  await expect(fetchReviewApplication("crew", "app", 1, signal())).rejects.toThrow();
  expect(h.terms).not.toHaveBeenCalled();
});
it.each(["proposed", "confirmed"])("blocks unresolved interview %s", async (state) => {
  h.interview.mockResolvedValue({ applicationStatus: "pending", state });
  expect(
    canApproveReview(await fetchReviewApplication("crew", "app", 1, signal()), "manager")
  ).toBe(false);
});
it("blocks unconfirmed current terms", async () => {
  h.terms.mockResolvedValue({ currentVersion: 2, items: [{ version: 2, confirmedAt: null }] });
  expect(
    canApproveReview(await fetchReviewApplication("crew", "app", 1, signal()), "manager")
  ).toBe(false);
});
it("accepts confirmed final terms", async () => {
  h.terms.mockResolvedValue({
    currentVersion: 2,
    items: [{ version: 2, confirmedAt: "2026-10-01T00:00:00Z" }],
  });
  expect(
    canApproveReview(await fetchReviewApplication("crew", "app", 1, signal()), "manager")
  ).toBe(true);
});
it("posts selected approval once", async () => {
  expect(await decideReviewApplication(app, "manager", 1, "approve")).toEqual(result);
  expect(api.post).toHaveBeenCalledWith("/applications/app/approve", { service: "aurora" });
});
it("posts rejection", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...result, status: "rejected" });
  expect((await decideReviewApplication(app, "manager", 1, "reject")).status).toBe("rejected");
});
it.each([
  { id: "other" },
  { crewId: "other" },
  { positionId: "other" },
  { applicantId: "other" },
  { status: "pending" },
  { reviewerId: "other" },
  { reviewedAt: null },
])("rejects invalid receipt %j", async (patch) => {
  vi.mocked(api.post).mockResolvedValue({ ...result, ...patch });
  await expect(decideReviewApplication(app, "manager", 1, "approve")).rejects.toThrow();
});
it("prevents self approval", async () => {
  await expect(decideReviewApplication(app, "creator", 1, "approve")).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("blocks stale sessions", async () => {
  h.generation = 2;
  await expect(decideReviewApplication(app, "manager", 1, "approve")).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("never automatically retries a decision", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Network"));
  await expect(decideReviewApplication(app, "manager", 1, "approve")).rejects.toThrow();
  expect(api.post).toHaveBeenCalledTimes(1);
});
