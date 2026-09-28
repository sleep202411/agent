import { afterEach, expect, it, vi } from "vitest";
import {
  downloadBlob,
  downloadBatch,
  downloadBatchWithReport,
  batchAssetName,
} from "./storyboard-download";
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

it("cancels unsuccessful response bodies while preserving the HTTP error", async () => {
  const cancel = vi.fn().mockRejectedValue(new Error("cancel failed"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, body: { cancel } }));
  await expect(downloadBlob("https://cdn.test/file?signature=private", "shot.png")).rejects.toThrow(
    "HTTP 403"
  );
  expect(cancel).toHaveBeenCalledOnce();
});

it("reports per-file initiation and failure in original order without retaining URLs", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:batch";
      static revokeObjectURL = vi.fn();
    }
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("ok"))
    .mockResolvedValueOnce(new Response("denied", { status: 403 }))
    .mockResolvedValueOnce(new Response("ok"));
  vi.stubGlobal("fetch", fetcher);
  const report = await downloadBatchWithReport([
    { url: "https://cdn.test/a?signature=private", name: "same.png" },
    { url: "https://cdn.test/b", name: "same.png" },
    { url: "https://cdn.test/c", name: "last.png" },
  ]);
  expect(report).toEqual({
    initiated: 2,
    failed: 1,
    items: [
      { index: 0, name: "same.png", status: "initiated" },
      { index: 1, name: "same.png", status: "failed" },
      { index: 2, name: "last.png", status: "initiated" },
    ],
  });
  expect(JSON.stringify(report)).not.toContain("https:");
  expect(fetcher).toHaveBeenCalledTimes(3);
  await vi.runAllTimersAsync();
});

it("snapshots batch identities before the first asynchronous request", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          finish = r;
        })
    )
    .mockResolvedValueOnce(new Response("denied", { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  const assets = [
    { url: "first", name: "first.png" },
    { url: "second", name: "second.png" },
  ];
  const pending = downloadBatchWithReport(assets);
  assets[1]!.url = "replacement";
  assets[1]!.name = "changed.png";
  assets.push({ url: "extra", name: "extra.png" });
  finish(new Response("denied", { status: 403 }));
  const report = await pending;
  expect(report.items.map((x) => x.name)).toEqual(["first.png", "second.png"]);
  expect(fetcher.mock.calls.map((x) => x[0])).toEqual(["first", "second"]);
});

it("rejects cancelled empty reports and returns a zero-count normal empty report", async () => {
  await expect(downloadBatchWithReport([])).resolves.toEqual({
    items: [],
    initiated: 0,
    failed: 0,
  });
  const controller = new AbortController();
  controller.abort();
  await expect(downloadBatchWithReport([], controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});
