import { beforeEach, expect, it, vi } from "vitest";
import { storyCover } from "./story-cover-api";
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const projectId = "00000000-0000-4000-8000-000000000001",
  assetId = "00000000-0000-4000-8000-000000000002";
const scope = { projectId, chapterId: projectId, generation: 1 };
const asset = {
  id: assetId,
  kind: "image",
  status: "ready",
  moderationStatus: "approved",
  contentType: "image/png",
  previewUrl: "https://example.com/cover.png",
};
const project = {
  id: projectId,
  projectVersion: 4,
  status: "active",
  capabilities: ["story.read", "story.edit"],
  cover: null,
};
const command = { clientKey: projectId, expectedProjectVersion: 4, coverAssetId: assetId };
const signal = () => new AbortController().signal;
let raw: string | null;
const client = () =>
  storyCover(scope, "owner", {
    read: () => raw,
    write: (value) => {
      raw = value;
    },
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  raw = null;
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("candidate-assets") ? [{ asset }] : project
  );
  h.patch.mockResolvedValue({ ...project, projectVersion: 5, cover: asset });
});
it("writes a versioned project cover without changing the graph", async () => {
  const c = client();
  await expect(c.save(command, signal())).resolves.toMatchObject({
    cover: asset,
    projectVersion: 5,
  });
  expect(h.patch).toHaveBeenCalledWith(
    `/story-projects/${projectId}`,
    expect.objectContaining({
      retry: false,
      data: { expectedProjectVersion: 4, coverAssetId: assetId },
    })
  );
  expect(c.read()).toBeNull();
});
it("retains lost replies and verifies the current cover before retrying", async () => {
  const c = client();
  h.patch.mockRejectedValueOnce(Error("Connection lost"));
  await expect(c.save(command, signal())).rejects.toThrow("Connection lost");
  expect(c.read()).toEqual(command);
  h.get.mockResolvedValue({ ...project, projectVersion: 5, cover: asset });
  await expect(c.load(signal())).resolves.toMatchObject({ applied: true, pending: null });
  expect(h.patch).toHaveBeenCalledTimes(1);
  expect(c.read()).toBeNull();
});
it("does not rebase a pending cover change over another editor's project version", async () => {
  h.get.mockResolvedValue({ ...project, projectVersion: 5 });
  const c = client();
  await expect(c.save(command, signal())).rejects.toThrow("project changed");
  expect(h.patch).not.toHaveBeenCalled();
  expect(c.read()).toEqual(command);
});
it("rejects denied, archived, blocked or video covers before a write", async () => {
  for (const denied of [
    { ...project, capabilities: ["story.read"] },
    { ...project, status: "archived" },
  ]) {
    raw = null;
    h.get.mockResolvedValue(denied);
    await expect(client().save(command, signal())).rejects.toThrow("permission");
  }
  for (const invalid of [
    { ...asset, kind: "video" },
    { ...asset, moderationStatus: "blocked" },
    { ...asset, status: "uploading" },
  ]) {
    raw = null;
    h.get.mockImplementation(async (path: string) =>
      path.endsWith("candidate-assets") ? [{ asset: invalid }] : project
    );
    await expect(client().save(command, signal())).rejects.toThrow("unblocked image");
  }
  expect(h.patch).not.toHaveBeenCalled();
});
it("removes only the cover reference and validates the receipt", async () => {
  h.get.mockResolvedValue({ ...project, cover: asset });
  h.patch.mockResolvedValue({ ...project, projectVersion: 5 });
  const c = client();
  await c.save({ ...command, coverAssetId: null }, signal());
  expect(h.patch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ data: { expectedProjectVersion: 4, coverAssetId: null } })
  );
  raw = null;
  h.patch.mockResolvedValue({ ...project, projectVersion: 5, cover: asset });
  await expect(c.save({ ...command, coverAssetId: null }, signal())).rejects.toThrow("verified");
  expect(c.read()).not.toBeNull();
});
it("rejects cross-project receipts and account changes", async () => {
  h.get.mockResolvedValue({ ...project, id: assetId });
  await expect(client().load(signal())).rejects.toThrow("mismatch");
  h.generation = 2;
  await expect(client().save(command, signal())).rejects.toThrow("expired");
  expect(h.patch).not.toHaveBeenCalled();
});
