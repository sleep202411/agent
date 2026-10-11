import { beforeEach, expect, it, vi } from "vitest";
import { fetchChannelVideos, submitChannelVideo, reviewChannelVideo } from "./channel-videos-api";

const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
const scope = { ipId: "11111111-1111-4111-8111-111111111111", generation: 1, locale: "zh-CN" };
const id = "22222222-2222-4222-8222-222222222222";
const input = { assetId: id, title: " Video ", description: " Description " };
const decision = { id, status: "approved" as const, expectedVersion: 2 };
const video = { id, title: "Video", description: "", status: "pending", version: 2, url: null };
beforeEach(() => {
  h.generation = 1;
  h.get.mockReset();
  h.post.mockReset();
  h.patch.mockReset();
});
it("continues pagination when moderation filters every item", async () => {
  h.get.mockResolvedValue({ items: [], nextCursor: id, canManage: false });
  expect((await fetchChannelVideos(scope, null, new AbortController().signal)).nextCursor).toBe(id);
  expect(h.get).toHaveBeenCalledWith(
    expect.stringContaining("/video-submissions"),
    expect.objectContaining({ service: "aurora", retry: false, params: { cursor: undefined } })
  );
});
it("rejects repeated cursors", async () => {
  h.get.mockResolvedValue({ items: [], nextCursor: id, canManage: false });
  await expect(fetchChannelVideos(scope, id, new AbortController().signal)).rejects.toThrow(
    "cursor"
  );
});
it("retains pending moderation entries without inventing playback URLs", async () => {
  h.get.mockResolvedValue({ items: [video], nextCursor: null, canManage: true });
  expect((await fetchChannelVideos(scope, null, new AbortController().signal)).items[0]).toEqual(
    video
  );
});
it.each(["pending", "approved", "rejected"])(
  "accepts a deduplicated %s submission receipt",
  async (status) => {
    h.post.mockResolvedValue({ id, status });
    expect(await submitChannelVideo(scope, input)).toEqual({ id, status });
    expect(h.post).toHaveBeenCalledWith(expect.stringContaining("/video-submissions"), {
      service: "aurora",
      retry: false,
      data: { assetId: id, title: "Video", description: "Description" },
    });
  }
);
it("does not replay a submission automatically after a lost response", async () => {
  h.post.mockRejectedValue(new Error("Connection lost"));
  await expect(submitChannelVideo(scope, input)).rejects.toThrow("Connection lost");
  expect(h.post).toHaveBeenCalledOnce();
});
it.each([
  { title: " " },
  { title: "x".repeat(201) },
  { description: "x".repeat(5001) },
  { assetId: "bad" },
])("rejects invalid upload metadata before dispatch", async (invalid) => {
  await expect(submitChannelVideo(scope, { ...input, ...invalid })).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("sends the observed version and checks the review receipt", async () => {
  h.patch.mockResolvedValue({ status: "rejected" });
  await expect(reviewChannelVideo(scope, decision)).rejects.toThrow();
  expect(h.patch).toHaveBeenCalledWith(expect.stringContaining("/video-submissions"), {
    service: "aurora",
    retry: false,
    data: decision,
  });
});
it("preserves a version-conflict error without retrying", async () => {
  h.patch.mockRejectedValue(new Error("This submission has already changed."));
  await expect(reviewChannelVideo(scope, decision)).rejects.toThrow("already changed");
  expect(h.patch).toHaveBeenCalledOnce();
});
it("blocks every operation from an old account", async () => {
  h.generation++;
  await expect(fetchChannelVideos(scope, null, new AbortController().signal)).rejects.toThrow(
    "session"
  );
  await expect(submitChannelVideo(scope, input)).rejects.toThrow("session");
  await expect(reviewChannelVideo(scope, decision)).rejects.toThrow("session");
  expect(h.get).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
  expect(h.patch).not.toHaveBeenCalled();
});
it.each(["read", "submit", "review"])(
  "rejects late %s results after account replacement",
  async (kind) => {
    const response = async () => {
      h.generation++;
      return kind === "read"
        ? { items: [], nextCursor: null, canManage: false }
        : { id, status: "approved" };
    };
    h.get.mockImplementation(response);
    h.post.mockImplementation(response);
    h.patch.mockImplementation(response);
    await expect(
      kind === "read"
        ? fetchChannelVideos(scope, null, new AbortController().signal)
        : kind === "submit"
          ? submitChannelVideo(scope, input)
          : reviewChannelVideo(scope, decision)
    ).rejects.toThrow("session");
  }
);
it("rejects a response after the screen cancelled its read", async () => {
  const controller = new AbortController();
  h.get.mockImplementation(async () => {
    controller.abort();
    return { items: [], nextCursor: null, canManage: false };
  });
  await expect(fetchChannelVideos(scope, null, controller.signal)).rejects.toThrow();
});
