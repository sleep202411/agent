import { expect, it, vi } from "vitest";
import { collectIpPages } from "./collect-ip-pages";
it("deduplicates overlapping pages in server order", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ items: [{ id: "1" }, { id: "2" }], nextCursor: "next" })
    .mockResolvedValueOnce({ items: [{ id: "2" }, { id: "3" }], nextCursor: null });
  expect(await collectIpPages(read, new AbortController().signal)).toEqual({
    items: [{ id: "1" }, { id: "2" }, { id: "3" }],
  });
  expect(read.mock.calls).toEqual([[undefined], ["next"]]);
});
it("rejects cyclic cursors without returning partial data", async () => {
  const read = vi.fn().mockResolvedValue({ items: [{ id: "1" }], nextCursor: "same" });
  await expect(collectIpPages(read, new AbortController().signal)).rejects.toThrow("cursor");
  expect(read).toHaveBeenCalledTimes(2);
});
it("reports the page cap as incomplete instead of silently truncating", async () => {
  let n = 0;
  const read = vi.fn(() =>
    Promise.resolve({ items: [{ id: String(++n) }], nextCursor: String(n) })
  );
  await expect(collectIpPages(read, new AbortController().signal)).rejects.toThrow("page limit");
  expect(read).toHaveBeenCalledTimes(200);
});
it.each([false, true])("stops abandoned pagination (before read=%s)", async (before) => {
  const controller = new AbortController();
  if (before) controller.abort();
  const read = vi.fn(() => {
    controller.abort();
    return Promise.resolve({ items: [], nextCursor: "next" });
  });
  await expect(collectIpPages(read, controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(read).toHaveBeenCalledTimes(before ? 0 : 1);
});
it("propagates later-page failure without returning the first page as complete", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ items: [{ id: "1" }], nextCursor: "next" })
    .mockRejectedValueOnce(new Error("network"));
  await expect(collectIpPages(read, new AbortController().signal)).rejects.toThrow("network");
});
