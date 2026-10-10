import { beforeEach, expect, it, vi } from "vitest";
import {
  updateWork,
  createWork,
  getWorkTags,
  pickWorkFile,
  uploadWorkFile,
} from "./publish-work-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  upload: vi.fn(),
  pick: vi.fn(),
  platform: { OS: "ios" },
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post, postFormData: h.upload, postForm: h.post },
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("react-native", () => ({ Platform: h.platform }));
beforeEach(() => {
  vi.resetAllMocks();
  h.platform.OS = "ios";
});
it("reads tags from the raw top-level dictionary", async () => {
  h.get.mockResolvedValue({ all: { 1: "Drama", 2: "", bad: "Wrong" }, data: [] });
  expect(await getWorkTags()).toEqual([{ id: 1, name: "Drama" }]);
  expect(h.get.mock.calls[0][1].raw).toBe(true);
});
it("creates one record with Web's JSON contract", async () => {
  h.post.mockResolvedValue({ id: 12 });
  expect(await createWork({ title: " Film ", description: " Story ", tagIds: [1, 2] })).toBe("12");
  expect(h.post).toHaveBeenCalledWith("/vedio/create/personal/video", {
    service: "content",
    signal: undefined,
    data: { title: "Film", introduction: "Story", tags: [1, 2], viewStatus: 1 },
  });
});
it("rejects incomplete data before any write", async () => {
  await expect(createWork({ title: "", description: "Story", tagIds: [1] })).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("canceling the picker performs no upload", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  expect(await pickWorkFile("video")).toBeNull();
  expect(h.upload).not.toHaveBeenCalled();
});
it.each([
  { mimeType: "image/png", size: 10, lastModified: 0 },
  { mimeType: "video/mp4", size: 0 },
  { mimeType: "video/mp4", size: 6 * 1024 ** 3 },
])("rejects invalid video %j", async (asset) => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///v", name: "v", ...asset }],
  });
  await expect(pickWorkFile("video")).rejects.toThrow();
});
it("sends the native file and legacy video token to the content service", async () => {
  const append = vi.fn();
  vi.stubGlobal(
    "FormData",
    class {
      append = append;
    }
  );
  try {
    const signal = new AbortController().signal;
    await uploadWorkFile(
      "12",
      "video",
      { uri: "file:///v", name: "v.mp4", mimeType: "video/mp4", size: 100, lastModified: 0 },
      "test-token",
      signal
    );
    expect(append).toHaveBeenCalledWith("token", "test-token");
    expect(append).toHaveBeenCalledWith("file", {
      uri: "file:///v",
      name: "v.mp4",
      type: "video/mp4",
    });
    expect(h.upload.mock.calls[0][0]).toBe("/vedio/upload/personal/video/backup");
    expect(h.upload.mock.calls[0][2].signal).toBe(signal);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("does not send an aborted upload", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    uploadWorkFile(
      "12",
      "cover",
      { uri: "file:///c", name: "c.png", mimeType: "image/png", size: 10, lastModified: 0 },
      "",
      controller.signal
    )
  ).rejects.toThrow();
  expect(h.upload).not.toHaveBeenCalled();
});

it("updates only title and introduction, leaving privacy and tags untouched", async () => {
  await updateWork("42", " Film ", " Description ");
  expect(h.post).toHaveBeenCalledWith(
    "/vedio/update/personal/video",
    { id: "42", title: "Film", introduction: "Description" },
    { service: "content", signal: undefined }
  );
});

it.each([12, { id: 12 }, "12"])(
  "accepts Web creation receipt %j for title-only works",
  async (receipt) => {
    h.post.mockResolvedValue(receipt);
    expect(await createWork({ title: "Film", description: "", tagIds: [] })).toBe("12");
    expect(h.post.mock.calls[0][1].data).toEqual({ title: "Film", viewStatus: 1 });
  }
);
it.each([null, {}, 0, -1, NaN, 1.5, true, { id: " " }])(
  "rejects invalid creation receipt %j",
  async (receipt) => {
    h.post.mockResolvedValue(receipt);
    await expect(createWork({ title: "Film", description: "", tagIds: [] })).rejects.toThrow(
      "Invalid created work ID"
    );
  }
);
it("allows editing a work without a description", async () => {
  await updateWork("12", "Film", "");
  expect(h.post).toHaveBeenCalledWith(
    "/vedio/update/personal/video",
    { id: "12", title: "Film", introduction: "" },
    { service: "content", signal: undefined }
  );
});
