import { afterEach, expect, it, vi } from "vitest";
import { downloadBlob, downloadBatch, batchAssetName } from "./storyboard-download";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.querySelectorAll("a[download]").forEach((el) => el.remove());
});
it("releases the URL and link after a failed click", async () => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:batch";
      static revokeObjectURL = revoke;
    }
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("image")));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    throw new Error("blocked");
  });
  await expect(downloadBlob("https://cdn.test/image.png", "shot_1.png")).rejects.toThrow("blocked");
  await vi.runAllTimersAsync();
  expect(revoke).toHaveBeenCalledWith("blob:batch");
  expect(document.querySelector("a[download]")).toBeNull();
});
it("retains a successful download URL until the next task", async () => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:batch";
      static revokeObjectURL = revoke;
    }
  );
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("image")));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  await downloadBlob("https://cdn.test/image.png", "shot_1.png");
  expect(revoke).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(revoke).toHaveBeenCalledOnce();
});

it("removes query and fragment text from names", () => {
  expect(batchAssetName("https://cdn.test/image.png?token=a.b#frame", 0, "image")).toBe(
    "shot_1_final.png"
  );
});
it("uses the existing media fallback when the last path segment has no extension", () => {
  expect(batchAssetName("https://cdn.test/media", 1, "video")).toBe("shot_2_final.mp4");
});
it("reports a failed batch while still attempting later files", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("denied", { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(
    await downloadBatch([
      { url: "first", name: "first.png" },
      { url: "second", name: "second.png" },
    ])
  ).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not start an already-abandoned batch", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(
    downloadBatch([{ url: "first", name: "first.png" }], controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).not.toHaveBeenCalled();
});
it("stops after cancellation during response-body reading", async () => {
  vi.useFakeTimers();
  let resolve!: (b: Blob) => void;
  const controller = new AbortController();
  const create = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    }
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      blob: () =>
        new Promise<Blob>((r) => {
          resolve = r;
        }),
    })
    .mockResolvedValue({ ok: true, blob: async () => new Blob(["next"]) });
  vi.stubGlobal("fetch", fetcher);
  const pending = downloadBatch(
    [
      { url: "first", name: "first.png" },
      { url: "second", name: "second.png" },
    ],
    controller.signal
  );
  const result = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(resolve).toBeDefined());
  controller.abort();
  resolve(new Blob(["old"]));
  await result;
  expect(create).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
