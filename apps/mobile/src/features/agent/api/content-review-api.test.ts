import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchWorkspaceSettings } from "./studio-workspace-settings-api";
import {
  getContentReviewPlayback,
  listContentReviews,
  getContentReview,
  addContentReviewComment,
} from "./content-review-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./studio-workspace-settings-api", () => ({ fetchWorkspaceSettings: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002",
  signal = new AbortController().signal;
const row = {
  id,
  mediaAssetId: other,
  fileName: "clip.mp4",
  durationSeconds: 60,
  creditsCharged: 10,
  findingCount: 0,
  suggestion: null,
  riskLevel: null,
  createdByUserId: "user",
  createdAt: "2026-10-01T00:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(fetchWorkspaceSettings).mockResolvedValue({
    id: "workspace",
    name: "Team",
    description: null,
    avatarUrl: null,
    isDefault: false,
    status: "active",
    version: 1,
    role: "viewer",
    accessScope: "workspace",
  });
  vi.mocked(api.get).mockResolvedValue({ items: [row] });
});
it("reads reports using explicit workspace context and fresh membership", async () => {
  expect(await listContentReviews("workspace", 1, signal)).toEqual([row]);
  expect(api.get).toHaveBeenCalledWith(
    "/content-review/records",
    expect.objectContaining({
      headers: { "x-fizz-workspace-id": "workspace" },
      signal,
      retry: false,
    })
  );
});
it("rejects project-only access before requesting reports", async () => {
  vi.mocked(fetchWorkspaceSettings).mockResolvedValue({
    ...(await fetchWorkspaceSettings("workspace", 1)),
    accessScope: "project_only",
  });
  await expect(listContentReviews("workspace", 1, signal)).rejects.toThrow("membership");
  expect(api.get).not.toHaveBeenCalled();
});
it("does not return private reports after account changes", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation = 2;
    return { items: [row] };
  });
  await expect(listContentReviews("workspace", 1, signal)).rejects.toThrow("expired");
});
it("rejects a detail response for a different report", async () => {
  vi.mocked(api.get).mockResolvedValue({
    ...row,
    id: other,
    exportFileName: "report.xlsx",
    overview: {},
    details: [],
    comments: [],
  });
  await expect(getContentReview("workspace", 1, id, signal)).rejects.toThrow("mismatch");
});
it("preserves findings and timestamped comments without treating missing values as zero", async () => {
  const data = {
    ...row,
    exportFileName: "report.xlsx",
    overview: { audioRiskLevel: "medium" },
    details: [{ source: "audio", timeOffset: "20s", description: "Check audio", confidence: null }],
    comments: [
      {
        id: "comment",
        seconds: 20,
        body: "Checked",
        createdByUserId: "user",
        createdAt: row.createdAt,
      },
    ],
  };
  vi.mocked(api.get).mockResolvedValue(data);
  expect(await getContentReview("workspace", 1, id, signal)).toEqual(data);
});

it("posts a timestamped comment once with explicit workspace scope", async () => {
  const result = {
    ...row,
    exportFileName: "report.xlsx",
    overview: {},
    details: [],
    comments: [
      { id: "c", seconds: 20, body: "Reviewed", createdByUserId: "user", createdAt: row.createdAt },
    ],
  };
  vi.mocked(api.post).mockResolvedValue(result);
  expect(
    await addContentReviewComment("workspace", 1, id, { seconds: 20, body: " Reviewed " }, signal)
  ).toEqual(result);
  expect(api.post).toHaveBeenCalledWith(
    `/content-review/records/${id}/comments`,
    expect.objectContaining({
      data: { seconds: 20, body: "Reviewed" },
      headers: { "x-fizz-workspace-id": "workspace" },
      retry: false,
    })
  );
});
it("rejects invalid comment input before contacting the server", async () => {
  await expect(
    addContentReviewComment("workspace", 1, id, { seconds: Infinity, body: "text" }, signal)
  ).rejects.toThrow();
  await expect(
    addContentReviewComment("workspace", 1, id, { seconds: 0, body: " " }, signal)
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("does not retry an uncertain comment write", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Response lost"));
  await expect(
    addContentReviewComment("workspace", 1, id, { seconds: 0, body: "text" }, signal)
  ).rejects.toThrow("Response lost");
  expect(api.post).toHaveBeenCalledTimes(1);
});

it("resolves playback only through the authorized report asset", async () => {
  const report = { ...row, exportFileName: "r.xlsx", overview: {}, details: [], comments: [] };
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.startsWith("/content-review")
      ? report
      : { assetId: other, variantKey: "original", url: "https://files.test/video", expiresAt: null }
  );
  expect(await getContentReviewPlayback("workspace", 1, id, signal)).toMatchObject({
    assetId: other,
    url: "https://files.test/video",
  });
  expect(api.get).toHaveBeenLastCalledWith(
    `/media/assets/${other}/access`,
    expect.objectContaining({ params: { variantKey: "original" }, signal })
  );
});

it("exports freshly authorized complete report fields using the official binary contract", async () => {
  const { exportContentReview } = await import("./content-review-api");
  const overview = {
    userId: 9,
    taskId: "moderation-id",
    requestId: "request",
    url: "https://files.test/video",
    riskLevel: "low",
  };
  vi.mocked(api.get).mockResolvedValue({
    ...row,
    exportFileName: "report.xlsx",
    overview,
    details: [],
    comments: [],
  });
  vi.mocked(api.post).mockResolvedValue({
    bytes: new Uint8Array([80, 75, 3, 4]).buffer,
    contentType: "application/octet-stream",
    disposition: "attachment; filename*=UTF-8''report%20one.xlsx",
  });
  const result = await exportContentReview("workspace", 1, id, signal);
  expect(result.filename).toBe("report one.xlsx");
  expect(api.post).toHaveBeenCalledWith(
    "/api/user/video/moderation/ai/exportExcel",
    expect.objectContaining({
      service: "studio",
      responseType: "binary",
      retry: false,
      signal,
      timeout: 60000,
      data: { overview, details: [], fileName: "report.xlsx" },
    })
  );
});
it("refuses non-Excel downloads and sanitizes filenames", async () => {
  const { exportContentReview, reportFilename } = await import("./content-review-api");
  vi.mocked(api.get).mockResolvedValue({
    ...row,
    exportFileName: "report.xlsx",
    overview: {},
    details: [],
    comments: [],
  });
  vi.mocked(api.post).mockResolvedValue({
    bytes: new Uint8Array([80, 75, 3, 4]).buffer,
    contentType: "text/html",
    disposition: null,
  });
  await expect(exportContentReview("workspace", 1, id, signal)).rejects.toThrow("Invalid Excel");
  vi.mocked(api.post).mockResolvedValue({
    bytes: new Uint8Array([123, 34, 0, 0]).buffer,
    contentType: "application/octet-stream",
    disposition: null,
  });
  await expect(exportContentReview("workspace", 1, id, signal)).rejects.toThrow("Invalid Excel");
  expect(reportFilename('attachment; filename="../../evil.xlsx"', "fallback")).toBe("evil.xlsx");
  expect(reportFilename("attachment; filename*=UTF-8''%ZZ", "clip.mp4")).toBe("clip.xlsx");
});
