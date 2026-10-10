import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  acceptApplicationOffer,
  fetchApplicationThread,
  fetchMyApplications,
  fetchApplicationTerms,
  confirmApplicationTerms,
  type Application,
  type Terms,
} from "./application-terms-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const app: Application = {
  id: "app",
  crewId: "crew",
  applicantId: "creator",
  crewName: "Crew",
  positionType: "Director",
  taskId: null,
  status: "pending",
  createdAt: "2026-09-30T00:00:00Z",
};
const row: Terms = {
  id: "00000000-0000-4000-8000-000000000001",
  applicationId: "app",
  version: 2,
  scope: "Storyboards",
  feeAmount: "9999999999999999",
  currency: "USD",
  feePeriod: "episode",
  revenueShareBp: 250,
  shareBasis: "Net receipts",
  proposedByUserId: "producer",
  createdAt: app.createdAt,
  confirmedAt: null,
};
const result = { ...row, confirmedAt: "2026-09-30T01:00:00Z" };
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.post).mockResolvedValue(result);
});
it("loads only the current applicant's scoped page", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [app], nextCursor: null });
  expect((await fetchMyApplications("creator", null, signal())).items).toEqual([app]);
  expect(api.get).toHaveBeenCalledWith(
    "/me/crew-applications",
    expect.objectContaining({ service: "aurora", params: { limit: 20 } })
  );
});
it.each([
  { items: [{ ...app, applicantId: "foreign" }], nextCursor: null },
  { items: [app, app], nextCursor: null },
  { items: [app], nextCursor: "cursor" },
])("rejects foreign/duplicate/looped application pages", async (page) => {
  vi.mocked(api.get).mockResolvedValue(page);
  await expect(fetchMyApplications("creator", "cursor", signal())).rejects.toThrow();
});
it("loads latest terms with exact large minor-unit strings", async () => {
  vi.mocked(api.get).mockResolvedValue({
    currentVersion: 2,
    items: [row],
    nextBeforeVersion: null,
  });
  expect((await fetchApplicationTerms("app", null, signal())).items[0]?.feeAmount).toBe(
    "9999999999999999"
  );
});
it("loads older terms using the version cursor", async () => {
  vi.mocked(api.get).mockResolvedValue({
    currentVersion: 2,
    items: [{ ...row, version: 1 }],
    nextBeforeVersion: null,
  });
  await fetchApplicationTerms("app", 2, signal());
  expect(api.get).toHaveBeenCalledWith(
    "/applications/app/terms",
    expect.objectContaining({ params: { limit: 20, beforeVersion: 2 } })
  );
});
it.each([
  { currentVersion: 2, items: [], nextBeforeVersion: null },
  { currentVersion: 2, items: [{ ...row, applicationId: "other" }], nextBeforeVersion: null },
  { currentVersion: 2, items: [row, row], nextBeforeVersion: null },
  { currentVersion: 2, items: [row], nextBeforeVersion: 1 },
  { currentVersion: 2, items: [{ ...row, feeAmount: 12 }], nextBeforeVersion: null },
])("rejects inconsistent terms snapshots", async (page) => {
  vi.mocked(api.get).mockResolvedValue(page);
  await expect(fetchApplicationTerms("app", null, signal())).rejects.toThrow();
});
it("allows an application with no proposed terms", async () => {
  vi.mocked(api.get).mockResolvedValue({ currentVersion: 0, items: [], nextBeforeVersion: null });
  expect((await fetchApplicationTerms("app", null, signal())).currentVersion).toBe(0);
});
it("confirms exactly the reviewed version", async () => {
  expect(await confirmApplicationTerms(app, row, "creator", 1)).toEqual(result);
  expect(api.post).toHaveBeenCalledWith("/applications/app/terms/confirm", {
    service: "aurora",
    data: { version: 2 },
  });
});
it("retries consent to the same version after response loss", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Network"));
  await expect(confirmApplicationTerms(app, row, "creator", 1)).rejects.toThrow("Network");
  await confirmApplicationTerms(app, row, "creator", 1);
  expect(vi.mocked(api.post).mock.calls[0]).toEqual(vi.mocked(api.post).mock.calls[1]);
});
it.each([
  { version: 3 },
  { applicationId: "other" },
  { feeAmount: "123" },
  { scope: "Changed" },
  { confirmedAt: null },
])("rejects mismatched consent receipt", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...result, ...change });
  await expect(confirmApplicationTerms(app, row, "creator", 1)).rejects.toThrow();
});
it("does not consent for another creator or a closed application", async () => {
  await expect(confirmApplicationTerms(app, row, "other", 1)).rejects.toThrow();
  await expect(
    confirmApplicationTerms({ ...app, status: "approved" }, row, "creator", 1)
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("blocks writes after account switch", async () => {
  h.generation = 2;
  await expect(confirmApplicationTerms(app, row, "creator", 1)).rejects.toThrow("session expired");
  expect(api.post).not.toHaveBeenCalled();
});
it("ignores confirmation arriving after account switch", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return result;
  });
  await expect(confirmApplicationTerms(app, row, "creator", 1)).rejects.toThrow("session expired");
});

const thread = {
  ...app,
  positionId: "position",
  ownerUserId: "owner",
  taskTitle: "Storyboard",
  dueAt: null,
};
it("looks up the exact applicant thread independently of list pagination", async () => {
  vi.mocked(api.get).mockResolvedValue(thread);
  expect(await fetchApplicationThread("app", "creator", 1, signal())).toEqual(thread);
  expect(api.get).toHaveBeenCalledWith(
    "/applications/app",
    expect.objectContaining({ retry: false, credentials: "include" })
  );
  await expect(fetchApplicationThread("app", "other", 1, signal())).rejects.toThrow("account");
});
it("accepts the exact reviewed offer and verifies confirmed terms after approval", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...thread, status: "approved" });
  vi.mocked(api.get).mockResolvedValue({
    currentVersion: 2,
    items: [result],
    nextBeforeVersion: null,
  });
  expect(await acceptApplicationOffer(thread, row, "creator", 1)).toEqual(result);
  expect(api.post).toHaveBeenCalledWith(
    "/applications/app/accept-offer",
    expect.objectContaining({ retry: false, data: { version: 2 } })
  );
});
it.each([
  { applicantId: "other" },
  { id: "other" },
  { crewId: "other" },
  { positionId: "other" },
  { status: "pending" },
])("does not trust mismatched offer receipts %j", async (patch) => {
  vi.mocked(api.post).mockResolvedValue({ ...thread, status: "approved", ...patch });
  await expect(acceptApplicationOffer(thread, row, "creator", 1)).rejects.toThrow();
});
it("does not claim acceptance when confirmed terms differ or cannot be read", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...thread, status: "approved" });
  vi.mocked(api.get).mockResolvedValue({
    currentVersion: 2,
    items: [{ ...result, feeAmount: "1" }],
    nextBeforeVersion: null,
  });
  await expect(acceptApplicationOffer(thread, row, "creator", 1)).rejects.toThrow("verified");
  vi.mocked(api.get).mockRejectedValue(new Error("Offline"));
  await expect(acceptApplicationOffer(thread, row, "creator", 1)).rejects.toThrow("Offline");
});
it("allows accepting already confirmed terms but rejects wrong applicants and stale sessions", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...thread, status: "approved" });
  vi.mocked(api.get).mockResolvedValue({
    currentVersion: 2,
    items: [result],
    nextBeforeVersion: null,
  });
  expect(await acceptApplicationOffer(thread, result, "creator", 1)).toEqual(result);
  vi.mocked(api.post).mockClear();
  await expect(acceptApplicationOffer(thread, row, "other", 1)).rejects.toThrow();
  h.generation = 2;
  await expect(acceptApplicationOffer(thread, row, "creator", 1)).rejects.toThrow("expired");
  expect(api.post).not.toHaveBeenCalled();
});

it("allows server-authorized reviewers only in explicit participant mode", async () => {
  vi.mocked(api.get).mockResolvedValue(thread);
  await expect(fetchApplicationThread("app", "reviewer", 1, signal())).rejects.toThrow("account");
  expect(await fetchApplicationThread("app", "reviewer", 1, signal(), "either")).toEqual(thread);
  vi.mocked(api.get).mockResolvedValue({ ...thread, id: "wrong" });
  await expect(fetchApplicationThread("app", "reviewer", 1, signal(), "either")).rejects.toThrow(
    "account"
  );
});

it("requests received applications and verifies the current owner on each row", async () => {
  vi.mocked(api.get).mockResolvedValue({
    items: [{ ...app, applicantId: "other", ownerUserId: "creator" }],
    nextCursor: null,
  });
  expect((await fetchMyApplications("creator", null, signal(), "received")).items).toHaveLength(1);
  expect(api.get).toHaveBeenCalledWith(
    "/me/crew-applications",
    expect.objectContaining({ params: { limit: 20, scope: "received" } })
  );
  vi.mocked(api.get).mockResolvedValue({
    items: [{ ...app, ownerUserId: "other" }],
    nextCursor: null,
  });
  await expect(fetchMyApplications("creator", null, signal(), "received")).rejects.toThrow(
    "account"
  );
});

it("refuses confirmation if the returned payment terms differ from the reviewed offer", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...result, paymentTerms: "monthly" });
  await expect(
    confirmApplicationTerms(app, { ...row, paymentTerms: "half_upfront" }, "creator", 1)
  ).rejects.toThrow("could not be verified");
});
