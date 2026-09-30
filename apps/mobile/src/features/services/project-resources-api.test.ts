import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchProjectResources,
  addProjectResource,
  removeProjectResource,
  resolveProjectResource,
  resourceUrl,
} from "./project-resources-api";
const h = vi.hoisted(() => ({ generation: 1, node: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock("../crew-assets/organization-api", () => ({ fetchOrganizationNode: h.node }));
const id = "11111111-1111-4111-8111-111111111111",
  nodeId = "22222222-2222-4222-8222-222222222222",
  mediaId = "33333333-3333-4333-8333-333333333333";
const resource = {
  id,
  crewId: "crew",
  kind: "link" as const,
  title: "Guide",
  url: "https://example.com/guide",
  assetNodeId: null,
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
};
const input = { kind: "link" as const, title: "Guide", url: resource.url };
let resources: (typeof resource)[], permissions: string[];
const read = () => fetchProjectResources("crew", "actor", 1, new AbortController().signal);
const add = () => addProjectResource("crew", "actor", 1, input);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  resources = [];
  permissions = ["production.view", "production.manage"];
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions }
      : path.includes("/nodes/")
        ? {
            node: {
              id: nodeId,
              kind: "file",
              status: "active",
              name: "Movie",
              media: { id: mediaId, kind: "video", contentType: "video/mp4" },
            },
          }
        : { page: { crewId: "crew" }, resources, capabilities: { manage: true } }
  );
  vi.mocked(api.post).mockResolvedValue(resource);
  h.node.mockResolvedValue({ id: nodeId, kind: "file", media: { id: mediaId } });
});
it("adds a scoped link without asset mutation", async () => {
  await add();
  expect(api.post).toHaveBeenCalledWith("/crews/crew/production-resources", {
    service: "aurora",
    data: input,
  });
  expect(h.node).not.toHaveBeenCalled();
});
it("adds a file only after current asset access is checked", async () => {
  vi.mocked(api.post).mockResolvedValue({
    ...resource,
    kind: "asset",
    url: null,
    assetNodeId: nodeId,
  });
  await addProjectResource("crew", "actor", 1, { kind: "asset", assetNodeId: nodeId });
  expect(h.node).toHaveBeenCalledTimes(1);
});
it.each([
  { kind: "folder", media: null },
  { kind: "file", media: null },
])("rejects unavailable file %j", async (node) => {
  h.node.mockResolvedValue(node);
  await expect(
    addProjectResource("crew", "actor", 1, { kind: "asset", assetNodeId: nodeId })
  ).rejects.toThrow("available Crew file");
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  "javascript:alert(1)",
  "file:///tmp/test",
  "https://user:password@example.com",
  "not a URL",
  "",
])("rejects unsafe URLs without throwing from safeParse %s", (url) => {
  expect(resourceUrl.safeParse(url).success).toBe(false);
});
it("allows read-only production viewers", async () => {
  permissions = ["production.view"];
  expect((await read()).canManage).toBe(false);
  await expect(add()).rejects.toThrow("management");
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects a cross-Crew resource", async () => {
  resources = [{ ...resource, crewId: "other" }];
  await expect(read()).rejects.toThrow("scope");
});
it("rejects duplicate resource IDs", async () => {
  resources = [resource, resource];
  await expect(read()).rejects.toThrow("scope");
});
it("rejects mismatched account", async () => {
  vi.mocked(api.get).mockResolvedValue({ userId: "other", permissions });
  await expect(read()).rejects.toThrow("account mismatch");
});
it("removes only the project reference", async () => {
  resources = [resource];
  await removeProjectResource("crew", "actor", 1, resource);
  expect(api.delete).toHaveBeenCalledWith(`/crew-production-resources/${id}`, {
    service: "aurora",
  });
  expect(api.delete).toHaveBeenCalledTimes(1);
});
it("does not treat a missing reference as successful removal", async () => {
  await expect(removeProjectResource("crew", "actor", 1, resource)).rejects.toThrow("removed");
  expect(api.delete).not.toHaveBeenCalled();
});
it("blocks removal when the reference changed", async () => {
  resources = [{ ...resource, title: "Changed" }];
  await expect(removeProjectResource("crew", "actor", 1, resource)).rejects.toThrow("changed");
  expect(api.delete).not.toHaveBeenCalled();
});
it("resolves current file media on demand", async () => {
  const asset = { ...resource, kind: "asset" as const, url: null, assetNodeId: nodeId };
  vi.mocked(api.get).mockImplementation(async (path) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions }
      : path.includes("/nodes/")
        ? {
            node: {
              id: nodeId,
              kind: "file",
              status: "active",
              name: "Movie",
              media: { id: mediaId, kind: "video", contentType: "video/mp4" },
            },
          }
        : { page: { crewId: "crew" }, resources: [asset], capabilities: { manage: true } }
  );
  expect(
    await resolveProjectResource("crew", "actor", 1, asset, new AbortController().signal)
  ).toEqual({
    kind: "asset",
    name: "Movie",
    mediaAssetId: mediaId,
    mediaKind: "video",
    contentType: "video/mp4",
  });
});
it("does not open stale links", async () => {
  resources = [{ ...resource, url: "https://example.com/changed" }];
  await expect(
    resolveProjectResource("crew", "actor", 1, resource, new AbortController().signal)
  ).rejects.toThrow("changed");
});
it("rejects unsafe existing links when opened", async () => {
  const bad = { ...resource, url: "javascript:alert(1)" };
  resources = [bad];
  await expect(
    resolveProjectResource("crew", "actor", 1, bad, new AbortController().signal)
  ).rejects.toThrow();
});
it.each([{ crewId: "other" }, { url: "https://other.example" }, { title: "Wrong" }])(
  "rejects incorrect receipts %j",
  async (change) => {
    vi.mocked(api.post).mockResolvedValue({ ...resource, ...change });
    await expect(add()).rejects.toThrow("could not be verified");
  }
);
it("never automatically retries uncertain creation", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Connection lost"));
  await expect(add()).rejects.toThrow("Connection lost");
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("blocks account changes before writes", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation++;
    return { userId: "actor", permissions };
  });
  await expect(add()).rejects.toThrow("expired");
  expect(api.post).not.toHaveBeenCalled();
});
it("ignores receipts for another session", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation++;
    return resource;
  });
  await expect(add()).rejects.toThrow("expired");
});
