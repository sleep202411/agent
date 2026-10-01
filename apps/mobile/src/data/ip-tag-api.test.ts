import { beforeEach, expect, it, vi } from "vitest";
import { fetchIpTagPage } from "./ip-api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/config", () => ({ appEnv: {}, resolveAssetUrl: (v: string) => v }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "zh-HK" }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
  ApiRequestError: class extends Error {},
}));
const page = () => ({
  term: { code: "hidden/tag", label: "Activity", description: null },
  total: 2,
  items: [{ id: "one", title: "Entry", tags: ["Activity"], tagCodes: ["hidden/tag"] }],
  nextCursor: "one",
});
beforeEach(() => {
  h.get.mockReset();
});
it("uses the dedicated public scope, encoded code, current locale and cancellation", async () => {
  h.get.mockResolvedValue(page());
  const signal = new AbortController().signal;
  const result = await fetchIpTagPage("hidden/tag", { signal });
  expect(h.get).toHaveBeenCalledWith("/ip-commerce/tags/hidden%2Ftag/ips", {
    service: "aurora",
    signal,
    params: { cursor: undefined, limit: 24, locale: "zh-HK" },
  });
  expect(result.items[0]).toMatchObject({ id: "one", typeTagCodes: ["hidden/tag"] });
  expect(result.total).toBe(2);
});
it("passes the next cursor and accepts null totals on later pages", async () => {
  h.get.mockResolvedValue({ ...page(), total: null, nextCursor: null });
  await expect(fetchIpTagPage("hidden/tag", { cursor: "prior" })).resolves.toMatchObject({
    total: null,
    nextCursor: null,
  });
  expect(h.get.mock.calls[0]?.[1].params.cursor).toBe("prior");
});
it("rejects wrong tag metadata, duplicate entries and stuck or unrelated cursors", async () => {
  for (const value of [
    null,
    { ...page(), term: { ...page().term, code: "other" } },
    { ...page(), total: -1 },
    { ...page(), items: [page().items[0], page().items[0]] },
    { ...page(), nextCursor: "other" },
    page(),
  ]) {
    h.get.mockResolvedValueOnce(value);
    await expect(fetchIpTagPage("hidden/tag", { cursor: "one" })).rejects.toThrow(
      "Invalid activity response"
    );
  }
});
it("does not request invalid codes and preserves backend failures", async () => {
  for (const code of ["", " ", "a".repeat(81)])
    await expect(fetchIpTagPage(code)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
  const error = Object.assign(new Error("Tag not found"), { status: 404 });
  h.get.mockRejectedValue(error);
  await expect(fetchIpTagPage("unknown")).rejects.toMatchObject({
    message: "Tag not found",
    status: 404,
  });
});
