import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchWorkspaceSettings } from "./studio-workspace-settings-api";
import { listContentReviews, getContentReview } from "./content-review-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
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
