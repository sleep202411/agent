import { beforeEach, expect, it, vi } from "vitest";
import { loadStoryCrewCandidates } from "./story-crew-candidates";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), generation: 1 };
const crew = { id: "crew-test", name: "Crew" };
const file = (n: number, kind = "image") => ({
  id: id(n),
  name: `File ${n}`,
  kind: "file",
  media: {
    id: id(n + 100),
    kind,
    contentType: `${kind}/test`,
    previewUrl: `/aurora/media/assets/${id(n + 100)}/content`,
  },
});
const page = (items: unknown[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
  parentId: null,
  source: "recent",
});
let controller: AbortController;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  controller = new AbortController();
});
const load = () => loadStoryCrewCandidates(scope, controller.signal);
it("skips listing for an unlinked project", async () => {
  h.get.mockResolvedValue({ crew: null });
  expect(await load()).toEqual({ crew: null, items: [] });
  expect(h.get).toHaveBeenCalledTimes(1);
});
it("traverses ACL-empty pages and deduplicates nodes and media", async () => {
  h.get
    .mockResolvedValueOnce({ crew })
    .mockResolvedValueOnce(page([], id(2)))
    .mockResolvedValueOnce(page([file(3), file(4, "video")], id(4)))
    .mockResolvedValueOnce(
      page([
        file(3),
        { ...file(5), media: file(3).media },
        file(6, "audio"),
        file(7, "document"),
        { ...file(8), kind: "folder", media: null },
      ])
    )
    .mockResolvedValueOnce({ crew });
  expect((await load()).items).toEqual([file(3), file(4, "video"), file(6, "audio")]);
  expect(h.get.mock.calls[2]).toEqual([
    `/story-projects/${id(1)}/crew-assets`,
    expect.objectContaining({
      params: { source: "recent", sort: "modified", limit: 200, cursor: id(2) },
      retry: false,
      signal: controller.signal,
      service: "aurora",
    }),
  ]);
});
it("rejects repeated cursors", async () => {
  h.get.mockResolvedValueOnce({ crew }).mockResolvedValue(page([file(3)], id(2)));
  await expect(load()).rejects.toThrow("repeated a cursor");
  expect(h.get).toHaveBeenCalledTimes(3);
});
it.each([null, { id: "replacement", name: "Other" }])(
  "rejects a changed Crew: %s",
  async (replacement) => {
    h.get
      .mockResolvedValueOnce({ crew })
      .mockResolvedValueOnce(page([file(3)]))
      .mockResolvedValueOnce({ crew: replacement });
    await expect(load()).rejects.toThrow("linked Crew changed");
  }
);
it("propagates permission failures without returning partial media", async () => {
  h.get
    .mockResolvedValueOnce({ crew })
    .mockResolvedValueOnce(page([file(3)], id(2)))
    .mockRejectedValueOnce(Error("Access revoked"));
  await expect(load()).rejects.toThrow("Access revoked");
});
it.each(["abort", "account"])("rejects a retired %s before another page", async (reason) => {
  h.get.mockResolvedValueOnce({ crew }).mockImplementationOnce(async () => {
    if (reason === "abort") controller.abort();
    else h.generation++;
    return page([file(3)], id(2));
  });
  await expect(load()).rejects.toThrow();
  expect(h.get).toHaveBeenCalledTimes(2);
});
it("rejects malformed pagination", async () => {
  h.get.mockResolvedValueOnce({ crew }).mockResolvedValueOnce({ items: [file(3)] });
  await expect(load()).rejects.toThrow();
});
it("rejects stale sessions before dispatch", async () => {
  h.generation++;
  await expect(load()).rejects.toThrow("session expired");
  expect(h.get).not.toHaveBeenCalled();
});
