import { beforeEach, expect, it, vi } from "vitest";
import {
  canDeleteWorkspace,
  createStudioWorkspace,
  deleteStudioWorkspace,
  fetchWorkspaceSettings,
  updateStudioWorkspace,
  WorkspaceSettingsWriteError,
} from "./studio-workspace-settings-api";
vi.mock("@/config/app-env", () => ({ appEnv: h.env }));
const h = vi.hoisted(() => ({
  generation: 1,
  env: { appRegion: "global" },
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  name: "Team",
  description: "Description",
  avatarUrl: "https://example.test/icon.png",
  isDefault: false,
  status: "active" as const,
  version: 3,
  role: "owner",
  accessScope: "workspace",
};
const draft = { name: "New", description: "New description" };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.env.appRegion = "global";
  h.get.mockResolvedValue({ workspace: row });
  h.patch.mockResolvedValue({ workspace: { ...row, ...draft, version: 4 } });
  h.post.mockResolvedValue({ workspace: { ...row, ...draft, version: 0 } });
  h.delete.mockResolvedValue({ deleted: true, workspaceId: id });
});
it("creates validated workspace details and checks the receipt", async () => {
  await createStudioWorkspace({ name: " New ", description: "New description" }, 1);
  expect(h.post).toHaveBeenCalledWith("/workspaces", { service: "aurora", data: draft });
});
it("rejects invalid input before requests", async () => {
  await expect(createStudioWorkspace({ name: " ", description: "" }, 1)).rejects.toThrow();
  await expect(
    updateStudioWorkspace(row, { name: "New", description: "x".repeat(501) }, 1)
  ).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("pins update version and preserves the avatar by omitting it", async () => {
  await updateStudioWorkspace(row, draft, 1);
  expect(h.patch).toHaveBeenCalledWith(`/workspaces/${id}`, {
    service: "aurora",
    data: { ...draft, expectedVersion: 3 },
  });
});
it("does not write stale versions", async () => {
  h.get.mockResolvedValue({ workspace: { ...row, version: 4 } });
  await expect(updateStudioWorkspace(row, draft, 1)).rejects.toThrow("changed");
  expect(h.patch).not.toHaveBeenCalled();
});
it("rechecks permissions and rejects scope mismatches", async () => {
  h.get.mockResolvedValue({ workspace: { ...row, role: "viewer" } });
  await expect(updateStudioWorkspace(row, draft, 1)).rejects.toThrow("permission");
  h.get.mockResolvedValue({ workspace: { ...row, id: "22222222-2222-4222-8222-222222222222" } });
  await expect(fetchWorkspaceSettings(id, 1)).rejects.toThrow("scope mismatch");
  expect(h.patch).not.toHaveBeenCalled();
});
it("requires exact deletion confirmation and rejects default workspace deletion", async () => {
  await expect(deleteStudioWorkspace(row, "Wrong", 1)).rejects.toThrow("exact");
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ workspace: { ...row, isDefault: true } });
  expect(canDeleteWorkspace({ ...row, isDefault: true })).toBe(false);
  await expect(deleteStudioWorkspace(row, "Team", 1)).rejects.toThrow("permission");
  expect(h.delete).not.toHaveBeenCalled();
});
it("pins deletion version and preserves server blockers", async () => {
  await deleteStudioWorkspace(row, "Team", 1);
  expect(h.delete).toHaveBeenCalledWith(`/workspaces/${id}`, {
    service: "aurora",
    data: { expectedVersion: 3 },
  });
  h.delete.mockRejectedValue(new Error("Workspace still has credits"));
  await expect(deleteStudioWorkspace(row, "Team", 1)).rejects.toThrow(
    "Workspace still has credits"
  );
});
it("marks lost or mismatched write receipts uncertain", async () => {
  h.post.mockRejectedValue(new Error("Lost response"));
  await expect(createStudioWorkspace(draft, 1)).rejects.toBeInstanceOf(WorkspaceSettingsWriteError);
  h.patch.mockResolvedValue({ workspace: { ...row, ...draft, version: 3 } });
  await expect(updateStudioWorkspace(row, draft, 1)).rejects.toBeInstanceOf(
    WorkspaceSettingsWriteError
  );
});
it("stops writes after account change or cancelled preflight", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return { workspace: row };
  });
  await expect(updateStudioWorkspace(row, draft, 1, c.signal)).rejects.toThrow("cancelled");
  expect(h.patch).not.toHaveBeenCalled();
  h.generation++;
  await expect(createStudioWorkspace(draft, 1)).rejects.toThrow("session expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("saves a selected preset and verifies its receipt", async () => {
  const avatarUrl = "https://studio.fizzdragon.com/team-icons/ocean.svg";
  h.patch.mockResolvedValue({ workspace: { ...row, ...draft, avatarUrl, version: 4 } });
  await updateStudioWorkspace(row, { ...draft, icon: "ocean" }, 1);
  expect(h.patch).toHaveBeenCalledWith(`/workspaces/${id}`, {
    service: "aurora",
    data: { ...draft, avatarUrl, expectedVersion: 3 },
  });
  h.post.mockResolvedValue({ workspace: { ...row, ...draft, avatarUrl, version: 0 } });
  await createStudioWorkspace({ ...draft, icon: "ocean" }, 1);
  expect(h.post).toHaveBeenCalledWith("/workspaces", {
    service: "aurora",
    data: { ...draft, avatarUrl },
  });
  h.patch.mockResolvedValue({ workspace: { ...row, ...draft, version: 4 } });
  await expect(updateStudioWorkspace(row, { ...draft, icon: "ocean" }, 1)).rejects.toBeInstanceOf(
    WorkspaceSettingsWriteError
  );
});

it("uses the China Studio host for China workspace icons", async () => {
  h.env.appRegion = "cn";
  const avatarUrl = "https://studio.fizzspace.cn/team-icons/aurora.svg";
  h.post.mockResolvedValue({ workspace: { ...row, ...draft, avatarUrl } });
  await createStudioWorkspace({ ...draft, icon: "aurora" }, 1);
  expect(h.post).toHaveBeenCalledWith("/workspaces", {
    service: "aurora",
    data: { ...draft, avatarUrl },
  });
});

it("writes a confirmed custom icon and verifies its receipt", async () => {
  const customIcon = "https://cdn.example.test/icon.png";
  h.patch.mockResolvedValue({ workspace: { ...row, ...draft, avatarUrl: customIcon, version: 4 } });
  await updateStudioWorkspace(row, { ...draft, customIcon }, 1);
  expect(h.patch).toHaveBeenCalledWith(
    `/workspaces/${id}`,
    expect.objectContaining({ data: { ...draft, avatarUrl: customIcon, expectedVersion: 3 } })
  );
  h.patch.mockResolvedValue({
    workspace: { ...row, ...draft, avatarUrl: "https://cdn.example.test/other.png", version: 4 },
  });
  await expect(updateStudioWorkspace(row, { ...draft, customIcon }, 1)).rejects.toThrow(
    "receipt mismatch"
  );
});
it.each(["http://cdn.test/icon.png", "file:///icon.png", "https://user:pass@cdn.test/icon.png"])(
  "rejects an unsafe custom icon %s before writing",
  async (customIcon) => {
    await expect(createStudioWorkspace({ ...draft, customIcon }, 1)).rejects.toThrow();
    expect(h.post).not.toHaveBeenCalled();
  }
);
