import { beforeEach, expect, it, vi } from "vitest";
import {
  storyListing,
  storyStoreListingSchema,
  type StoryListingCommand,
} from "./story-listing-api";
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const projectId = "00000000-0000-4000-8000-000000000001";
const imageId = "00000000-0000-4000-8000-000000000002";
const videoId = "00000000-0000-4000-8000-000000000003";
const listing = {
  description: "Description",
  developer: "Creator",
  tags: ["Film"],
  trailerAssetId: videoId,
  screenshotAssetIds: [imageId],
};
const project = {
  id: projectId,
  projectVersion: 4,
  status: "active",
  capabilities: ["story.read", "story.edit"],
  storeListing: null,
};
const command: StoryListingCommand = {
  clientKey: projectId,
  expectedProjectVersion: 4,
  storeListing: listing,
};
const asset = (id: string, kind: string) => ({
  asset: {
    id,
    kind,
    status: "ready",
    moderationStatus: "approved",
    contentType: kind + "/test",
    previewUrl: "https://example.com/media",
  },
});
let raw: string | null;
const signal = () => new AbortController().signal;
const client = () =>
  storyListing({ projectId, generation: 1 }, "42", {
    read: () => raw,
    write: (v) => {
      raw = v;
    },
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  raw = null;
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("candidate-assets") ? [asset(imageId, "image"), asset(videoId, "video")] : project
  );
  h.patch.mockImplementation(async (_path, options) => ({
    ...project,
    projectVersion: 5,
    storeListing: options.data.storeListing,
  }));
});
it("saves the complete listing with a version check and no unrelated project fields", async () => {
  const c = client();
  await c.save(command, signal());
  expect(h.patch).toHaveBeenCalledWith(
    "/story-projects/" + projectId,
    expect.objectContaining({
      retry: false,
      data: { expectedProjectVersion: 4, storeListing: listing },
    })
  );
  expect(c.read()).toBeNull();
});
it("saves incomplete text drafts and explicit clearing without a media read", async () => {
  const c = client();
  await c.save(
    {
      ...command,
      storeListing: {
        description: "",
        developer: "",
        tags: [],
        trailerAssetId: null,
        screenshotAssetIds: [],
      },
    },
    signal()
  );
  await c.save({ ...command, storeListing: null }, signal());
  expect(h.get.mock.calls.every(([path]) => !path.endsWith("candidate-assets"))).toBe(true);
});
it("recovers a lost response from current server state without another PATCH", async () => {
  const c = client();
  h.patch.mockRejectedValueOnce(Error("Connection lost"));
  await expect(c.save(command, signal())).rejects.toThrow("Connection lost");
  expect(c.read()).toEqual(command);
  h.get.mockResolvedValue({ ...project, projectVersion: 5, storeListing: listing });
  await expect(c.load(signal())).resolves.toMatchObject({ applied: true, pending: null });
  expect(h.patch).toHaveBeenCalledTimes(1);
});
it("preserves screenshot order and refuses to rebase onto a conflicting version", async () => {
  h.get.mockResolvedValue({
    ...project,
    projectVersion: 5,
    storeListing: { ...listing, screenshotAssetIds: [] },
  });
  const c = client();
  await expect(c.save(command, signal())).rejects.toThrow("project changed");
  expect(h.patch).not.toHaveBeenCalled();
  expect(c.read()).toEqual(command);
});
it.each(["blocked", "uploading", "missing", "wrongKind"])(
  "rejects unusable trailer media: %s",
  async (reason) => {
    h.get.mockImplementation(async (path: string) => {
      if (!path.endsWith("candidate-assets")) return project;
      const video = asset(videoId, reason === "wrongKind" ? "image" : "video");
      if (reason === "blocked") video.asset.moderationStatus = "blocked";
      if (reason === "uploading") video.asset.status = "uploading";
      return [asset(imageId, "image"), ...(reason === "missing" ? [] : [video])];
    });
    await expect(client().save(command, signal())).rejects.toThrow("trailer");
    expect(h.patch).not.toHaveBeenCalled();
  }
);
it("rejects non-image screenshots", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("candidate-assets") ? [asset(imageId, "video"), asset(videoId, "video")] : project
  );
  await expect(client().save(command, signal())).rejects.toThrow("screenshots");
  expect(h.patch).not.toHaveBeenCalled();
});
it.each([
  { ...project, capabilities: ["story.read"] },
  { ...project, status: "archived" },
])("rejects revoked editing or archived projects", async (value) => {
  h.get.mockResolvedValue(value);
  await expect(client().save(command, signal())).rejects.toThrow("permission");
  expect(h.patch).not.toHaveBeenCalled();
});
it("retains recovery on a mismatched save receipt", async () => {
  const c = client();
  h.patch.mockResolvedValue({
    ...project,
    projectVersion: 5,
    storeListing: { ...listing, description: "Different" },
  });
  await expect(c.save(command, signal())).rejects.toThrow("verified");
  expect(c.read()).toEqual(command);
});
it("refuses cross-project responses", async () => {
  h.get.mockResolvedValue({ ...project, id: imageId });
  await expect(client().save(command, signal())).rejects.toThrow("mismatch");
  expect(h.patch).not.toHaveBeenCalled();
});
it("does not write after account changes during media validation", async () => {
  h.get.mockImplementation(async (path: string) => {
    if (!path.endsWith("candidate-assets")) return project;
    h.generation = 2;
    return [asset(imageId, "image"), asset(videoId, "video")];
  });
  await expect(client().save(command, signal())).rejects.toThrow("expired");
  expect(h.patch).not.toHaveBeenCalled();
});
it("rejects aborts after a server write without dropping pending recovery", async () => {
  const c = client(),
    controller = new AbortController();
  h.patch.mockImplementation(async () => {
    controller.abort();
    return { ...project, projectVersion: 5, storeListing: listing };
  });
  await expect(c.save(command, controller.signal)).rejects.toThrow();
  expect(c.read()).toEqual(command);
});
it("matches official draft limits, trims text and rejects duplicate media/tags", () => {
  expect(
    storyStoreListingSchema.parse({ ...listing, description: " text ", developer: " owner " })
  ).toMatchObject({ description: "text", developer: "owner" });
  for (const patch of [
    { description: "x".repeat(13001) },
    { developer: "x".repeat(61) },
    { tags: ["Film", " Film "] },
    { tags: Array.from({ length: 13 }, (_, i) => String(i)) },
    { screenshotAssetIds: [imageId, imageId] },
    { retiredField: true },
  ])
    expect(storyStoreListingSchema.safeParse({ ...listing, ...patch }).success).toBe(false);
});
it("does not contact the server when durable storage fails", async () => {
  const c = storyListing({ projectId, generation: 1 }, "42", {
    read: () => null,
    write: () => {
      throw Error("Storage full");
    },
  });
  await expect(c.save(command, signal())).rejects.toThrow("Storage full");
  expect(h.get).not.toHaveBeenCalled();
  expect(h.patch).not.toHaveBeenCalled();
});
it("blocks overlapping save and discard while the first save is active", async () => {
  let finish!: (value: unknown) => void;
  h.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const c = client(),
    first = c.save(command, signal());
  await expect(c.save(command, signal())).rejects.toThrow("in progress");
  expect(() => c.discard(command.clientKey)).toThrow("in progress");
  finish(project);
  await first;
  expect(h.patch).toHaveBeenCalledTimes(1);
});
it("requires matching screenshot order before clearing recovery", async () => {
  const c = client();
  const next = {
    ...command,
    storeListing: { ...listing, screenshotAssetIds: [imageId, projectId] },
  };
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("candidate-assets")
      ? [asset(imageId, "image"), asset(projectId, "image"), asset(videoId, "video")]
      : project
  );
  h.patch.mockRejectedValueOnce(Error("Lost response"));
  await expect(c.save(next, signal())).rejects.toThrow("Lost response");
  h.get.mockResolvedValue({
    ...project,
    projectVersion: 5,
    storeListing: { ...listing, screenshotAssetIds: [projectId, imageId] },
  });
  await expect(c.load(signal())).resolves.toMatchObject({ applied: false, pending: next });
});
