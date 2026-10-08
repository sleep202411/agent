// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { downloadOutput } from "./download-output";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const labels = { failed: "Download failed", openOriginal: "Open original" };
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});
it("does not save HTTP error responses as media", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Access denied", { status: 403 })));
  await downloadOutput("https://storage.example/file", "file.png", labels);
  expect(click).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Download failed (HTTP 403)", expect.any(Object));
});
it.each([
  new Blob([], { type: "image/png" }),
  new Blob(['{"error":"denied"}'], { type: "application/json" }),
])("rejects empty and non-media error payloads", async (blob) => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => blob }));
  await downloadOutput("https://storage.example/file", "file.png", labels);
  expect(click).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});
it("offers an explicit original link when fetching is blocked", async () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await downloadOutput("https://storage.example/file", "file.png", labels);
  expect(open).not.toHaveBeenCalled();
  const options = vi.mocked(toast.error).mock.calls[0]![1]!;
  (options.action as unknown as { onClick: () => void }).onClick();
  expect(open).toHaveBeenCalledWith(
    "https://storage.example/file",
    "_blank",
    "noopener,noreferrer"
  );
});
it("downloads a successful response with its media extension and releases the URL", async () => {
  vi.useFakeTimers();
  const create = vi.fn().mockReturnValue("blob:result"),
    revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  let filename = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    filename = this.download;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["media"], { type: "image/webp" }),
    })
  );
  await downloadOutput("https://storage.example/file", "scene.png", labels);
  expect(filename).toBe("scene.webp");
  expect(toast.error).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(revoke).toHaveBeenCalledWith("blob:result");
});
it("recovers an allowed image download when storage CORS blocks fetch", async () => {
  vi.useFakeTimers();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:result");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["image"], { type: "image/png" }),
    });
  vi.stubGlobal("fetch", fetcher);
  const source = "https://r2.fizzdragon.com/result.png";
  await downloadOutput(source, "result.png", labels);
  expect(fetcher).toHaveBeenLastCalledWith(`/api/img?url=${encodeURIComponent(source)}`, {
    cache: "no-store",
  });
  expect(click).toHaveBeenCalledOnce();
  expect(toast.error).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
});
