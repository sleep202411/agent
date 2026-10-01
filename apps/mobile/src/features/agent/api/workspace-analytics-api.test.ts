import { generationUsage } from "../workspace-analytics-summary";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchWorkspaceSettings } from "./studio-workspace-settings-api";
import { loadPlatformProjects } from "./platform-projects-api";
import { loadWorkspaceAnalytics, analyticsTotals } from "./workspace-analytics-api";
import { fetchStudioMembers } from "./studio-members-api";
vi.mock("./studio-members-api", () => ({ fetchStudioMembers: vi.fn() }));
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("./studio-workspace-settings-api", () => ({ fetchWorkspaceSettings: vi.fn() }));
vi.mock("./platform-projects-api", () => ({ loadPlatformProjects: vi.fn() }));
const signal = new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(fetchStudioMembers).mockResolvedValue({
    members: [],
    canAdd: true,
    canRemove: true,
    canEdit: false,
  });
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
  vi.mocked(loadPlatformProjects).mockResolvedValue([]);
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("daily-usage")
      ? { days: [] }
      : path.endsWith("member-usage")
        ? { rangeDays: 30, projectId: null, members: [] }
        : path === "/ai/jobs"
          ? { jobs: [] }
          : { entries: [] }
  );
});
it("scopes every billing/job request and never asks for member usage as a viewer", async () => {
  const result = await loadWorkspaceAnalytics("workspace", 1, "", 30, signal);
  expect(result.memberUsage).toBeUndefined();
  expect(fetchStudioMembers).not.toHaveBeenCalled();
  expect(api.get).toHaveBeenCalledTimes(3);
  for (const [, config] of vi.mocked(api.get).mock.calls)
    expect(config).toMatchObject({ headers: { "x-fizz-workspace-id": "workspace" }, signal });
});
it("loads member usage only after fresh admin authorization", async () => {
  vi.mocked(fetchWorkspaceSettings).mockResolvedValue({
    ...(await fetchWorkspaceSettings("workspace", 1)),
    role: "admin",
  });
  expect((await loadWorkspaceAnalytics("workspace", 1, "", 30, signal)).memberUsage).toEqual([]);
  expect(api.get).toHaveBeenCalledWith(
    "/billing/wallet-ledger/member-usage",
    expect.objectContaining({ params: { days: 30 } })
  );
});
it("rejects foreign projects before reading financial data", async () => {
  await expect(loadWorkspaceAnalytics("workspace", 1, "foreign", 30, signal)).rejects.toThrow(
    "Project"
  );
  expect(api.get).not.toHaveBeenCalled();
});
it("rejects project-only access", async () => {
  vi.mocked(fetchWorkspaceSettings).mockResolvedValue({
    ...(await fetchWorkspaceSettings("workspace", 1)),
    accessScope: "project_only",
  });
  await expect(loadWorkspaceAnalytics("workspace", 1, "", 30, signal)).rejects.toThrow("access");
  expect(api.get).not.toHaveBeenCalled();
});
it("ignores data returned after an account change", async () => {
  vi.mocked(api.get).mockImplementation(async (path) => {
    h.generation = 2;
    return path.endsWith("daily-usage")
      ? { days: [] }
      : path === "/ai/jobs"
        ? { jobs: [] }
        : { entries: [] };
  });
  await expect(loadWorkspaceAnalytics("workspace", 1, "", 30, signal)).rejects.toThrow("expired");
});
it("does not count temporary holds/releases as incoming or outgoing usage", () => {
  const row = {
    id: "1",
    amount: "9007199254740993123",
    availableDelta: "9007199254740993123",
    heldDelta: "0",
    reason: "test",
    sourceType: "ai_job",
    sourceId: null,
    description: null,
    createdAt: "2026-10-01",
  };
  expect(
    analyticsTotals([
      { ...row, entryType: "hold" },
      { ...row, entryType: "release" },
    ])
  ).toEqual({ incoming: "0", outgoing: "0" });
  expect(
    analyticsTotals([
      { ...row, entryType: "credit" },
      { ...row, entryType: "settle", availableDelta: "0" },
    ])
  ).toEqual({ incoming: row.amount, outgoing: row.amount });
});

it("aggregates only job settlements, preserves precision and leaves unpriced jobs unknown", () => {
  const entry = {
    id: "e",
    entryType: "settle",
    amount: "9007199254740993123",
    availableDelta: "0",
    heldDelta: "0",
    reason: "job",
    sourceType: "ai_job",
    sourceId: "j1",
    description: null,
    createdAt: "2026-10-01",
  };
  const job = {
    id: "j1",
    modelId: "video",
    type: "video",
    status: "succeeded",
    createdAt: "2026-10-01",
  };
  const result = generationUsage({
    ledger: [
      entry,
      { ...entry, id: "e2", amount: "7" },
      { ...entry, entryType: "hold" },
      { ...entry, sourceType: "other" },
    ],
    jobs: [job, { ...job, id: "j2" }, { ...job, id: "j3", modelId: "image" }],
  });
  expect(result.settled.get("j1")).toBe(9007199254740993130n);
  expect(result.settled.has("j2")).toBe(false);
  expect(result.models).toEqual([
    { modelId: "video", count: 2, credits: 9007199254740993130n },
    { modelId: "image", count: 1, credits: 0n },
  ]);
});

it("joins member identities by user ID without exposing the member list to viewers", async () => {
  vi.mocked(fetchWorkspaceSettings).mockResolvedValue({
    ...(await fetchWorkspaceSettings("workspace", 1)),
    role: "admin",
  });
  vi.mocked(fetchStudioMembers).mockResolvedValue({
    canAdd: true,
    canRemove: true,
    canEdit: false,
    members: [
      {
        memberId: "m",
        userId: "u",
        nickname: "Artist",
        role: "editor",
        status: "active",
        isOwner: false,
        isSelf: false,
      },
    ],
  });
  const previous = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation(async (path, config) =>
    path.endsWith("member-usage")
      ? {
          rangeDays: 30,
          projectId: null,
          members: [
            { userId: "u", totalCredits: "7", totalJobs: 1, projects: [] },
            { userId: "departed", totalCredits: "3", totalJobs: 1, projects: [] },
          ],
        }
      : previous(path, config)
  );
  const result = await loadWorkspaceAnalytics("workspace", 1, "", 30, signal);
  expect(result.memberUsage?.map((m) => m.nickname)).toEqual(["Artist", null]);
  expect(fetchStudioMembers).toHaveBeenCalledWith(
    { kind: "workspace", id: "workspace", name: "Team" },
    1,
    signal
  );
});
