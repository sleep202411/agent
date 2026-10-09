import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchReview,
  missingReviewRequirements,
  canRequestReview,
  reviewOutbox,
  submitReview,
  type ReviewSnapshot,
} from "./review-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post },
  ApiRequestError: class extends Error {
    constructor(
      _code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  clientKey = "22222222-2222-4222-8222-222222222222",
  nextKey = "33333333-3333-4333-8333-333333333333";
const fixture = (): ReviewSnapshot => ({
  id,
  version: 1,
  sourceLocale: "en-US",
  title: "Story",
  summary: "Summary",
  status: "draft",
  listingVisibility: "unlisted",
  genreCodes: ["drama"],
  coverAsset: { id: nextKey },
  trailerAsset: null,
  copyrightOwner: "Alice",
  rightsSummary: { statement: "Original work" },
  aiDisclosure: null,
});
let snapshot: ReviewSnapshot;
const command = {
    clientKey,
    expectedVersion: 1,
    sourceLocale: "en-US" as const,
    changeSummary: "Ready for review",
  },
  signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  snapshot = fixture();
  h.get.mockImplementation(async () => ({ ip: snapshot }));
  h.post.mockImplementation(async () => ({
    ip: { ...snapshot, version: 2, status: "submitted", listingVisibility: "private" },
  }));
});
it("checks all readiness requirements and optional AI disclosure", () => {
  expect(missingReviewRequirements(fixture())).toEqual([]);
  expect(
    missingReviewRequirements({
      ...fixture(),
      title: " ",
      summary: "",
      genreCodes: [],
      coverAsset: null,
      copyrightOwner: null,
      rightsSummary: null,
      aiDisclosure: { generatedVisuals: true },
    })
  ).toEqual(["title", "summary", "genre", "asset", "copyright", "rights", "ai"]);
  expect(canRequestReview("approved")).toBe(true);
  for (const status of [
    "submitted",
    "in_review",
    "published",
    "scheduled",
    "suspended",
    "archived",
  ])
    expect(canRequestReview(status)).toBe(false);
});
it("reads the source language before assessing readiness", async () => {
  h.get.mockImplementation(async (_path, { params }) => ({
    ip: {
      ...fixture(),
      sourceLocale: "zh-CN",
      summary: params.locale === "zh-CN" ? "" : "Translated",
    },
  }));
  expect((await fetchReview(id, 1, signal())).summary).toBe("");
  expect(h.get.mock.calls.map((call) => call[1].params.locale)).toEqual(["en-US", "zh-CN"]);
});
it("saves an immutable pending request before POST and clears only a matching private submitted receipt", async () => {
  h.post.mockImplementation(async (_path, { data }) => {
    expect(reviewOutbox(id, "alice", 1).read()).toEqual(command);
    expect(data).toEqual({ expectedVersion: 1, changeSummary: "Ready for review" });
    return { ip: { ...snapshot, version: 2, status: "submitted", listingVisibility: "private" } };
  });
  await submitReview(id, "alice", 1, command, signal());
  expect(reviewOutbox(id, "alice", 1).read()).toBeNull();
});
it("retries unchanged-version failures with the same payload but never repeats a changed-version submission", async () => {
  h.post.mockRejectedValueOnce(new Error("Offline"));
  await expect(submitReview(id, "alice", 1, command, signal())).rejects.toThrow();
  await submitReview(id, "alice", 1, command, signal());
  expect(h.post.mock.calls[1][1].data).toEqual(h.post.mock.calls[0][1].data);
  h.post.mockImplementationOnce(async () => {
    snapshot = { ...snapshot, version: 2, status: "submitted", listingVisibility: "private" };
    throw Error("Lost reply");
  });
  await expect(submitReview(id, "alice", 1, command, signal())).rejects.toThrow();
  const writes = h.post.mock.calls.length;
  await expect(submitReview(id, "alice", 1, command, signal())).rejects.toThrow("review");
  expect(h.post).toHaveBeenCalledTimes(writes);
  expect(reviewOutbox(id, "alice", 1).read()).not.toBeNull();
});
it("checks fresh readiness and status before writing", async () => {
  snapshot.summary = "";
  await expect(submitReview(id, "alice", 1, command, signal())).rejects.toThrow("requirements");
  snapshot = fixture();
  snapshot.status = "in_review";
  await expect(submitReview(id, "alice", 1, command, signal())).rejects.toThrow("status");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects incorrect receipts and isolates pending records by account and IP", async () => {
  h.post.mockResolvedValue({ ip: { ...snapshot, version: 2, status: "published" } });
  await expect(submitReview(id, "alice", 1, command, signal())).rejects.toThrow("receipt");
  expect(() =>
    reviewOutbox(id, "alice", 1).save({ ...command, changeSummary: "Different" })
  ).toThrow();
  expect(reviewOutbox(id, "bob", 1).read()).toBeNull();
  expect(reviewOutbox(nextKey, "alice", 1).read()).toBeNull();
});
it("guards identity, auth changes and canceled calls", async () => {
  h.get.mockResolvedValueOnce({ ip: { ...snapshot, id: nextKey } });
  await expect(fetchReview(id, 1, signal())).rejects.toThrow("identity");
  h.get.mockImplementationOnce(async () => {
    h.generation = 2;
    return { ip: snapshot };
  });
  await expect(fetchReview(id, 1, signal())).rejects.toThrow("expired");
  h.generation = 1;
  const c = new AbortController();
  c.abort();
  await expect(submitReview(id, "alice", 1, command, c.signal)).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
