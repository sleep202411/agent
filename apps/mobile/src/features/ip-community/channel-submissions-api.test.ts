import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchChannelSubmissions,
  fetchSubmissionWorks,
  changeChannelSubmission,
} from "./channel-submissions-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
const scope = { ipId: "11111111-1111-4111-8111-111111111111", generation: 1, locale: "zh-CN" };
const cursor = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  h.generation = 1;
  h.get.mockReset();
  h.post.mockReset();
  h.patch.mockReset();
});
it.each(["entries", "works"])("rejects a repeated %s cursor instead of looping", async (kind) => {
  h.get.mockResolvedValue({
    community: true,
    open: true,
    canManage: false,
    items: [],
    nextCursor: cursor,
  });
  await expect(
    (kind === "entries" ? fetchChannelSubmissions : fetchSubmissionWorks)(
      scope,
      cursor,
      new AbortController().signal
    )
  ).rejects.toThrow("cursor");
});
it("sends locale and cursor without widening the public query", async () => {
  h.get.mockResolvedValue({ community: false, open: false, canManage: false, items: [] });
  await fetchChannelSubmissions(scope, cursor, new AbortController().signal);
  expect(h.get).toHaveBeenCalledWith(
    expect.stringContaining("/submissions"),
    expect.objectContaining({ params: { locale: "zh-CN", cursor }, retry: false })
  );
});
it("does not dispatch mutations for an old account", async () => {
  h.generation++;
  await expect(changeChannelSubmission(scope, { kind: "submit", workId: cursor })).rejects.toThrow(
    "session"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("does not accept a mismatched review receipt as success", async () => {
  h.patch.mockResolvedValue({ status: "pending" });
  await expect(
    changeChannelSubmission(scope, {
      kind: "review",
      workId: cursor,
      status: "approved",
      expectedVersion: 2,
    })
  ).rejects.toThrow();
  expect(h.patch).toHaveBeenCalledOnce();
});
it("rejects a read that resolves after cancellation", async () => {
  const controller = new AbortController();
  h.get.mockImplementation(async () => {
    controller.abort();
    return { community: false, open: false, canManage: false, items: [] };
  });
  await expect(fetchChannelSubmissions(scope, null, controller.signal)).rejects.toThrow();
});
