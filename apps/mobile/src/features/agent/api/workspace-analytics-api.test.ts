import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchWorkspaceSettings } from "./studio-workspace-settings-api";
import { loadPlatformProjects } from "./platform-projects-api";
import { loadWorkspaceAnalytics, analyticsTotals } from "./workspace-analytics-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("./studio-workspace-settings-api", () => ({ fetchWorkspaceSettings: vi.fn() }));
vi.mock("./platform-projects-api", () => ({ loadPlatformProjects: vi.fn() }));
const signal = new AbortController().signal;
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
