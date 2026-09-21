// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { downloadCanvasMedia } from "./download-media";
const revoke = vi.fn();
let click: ReturnType<typeof vi.spyOn>;
let names: string[];
beforeEach(() => {
  vi.useFakeTimers();
  names = [];
  revoke.mockClear();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => new Blob(["audio"], { type: "audio/ogg" }) })
  );
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => "blob:fixture"),
      revokeObjectURL: revoke,
    })
  );
  vi.spyOn(window, "open").mockReturnValue(null);
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    names.push(this.download);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("names supported Ogg audio according to its media type", async () => {
  await downloadCanvasMedia("https://media.invalid/sound", "Voice", "audio");
  expect(names).toEqual(["Voice.ogg"]);
});
it("releases an allocated object URL if the download click throws", async () => {
  click.mockImplementation(() => {
    throw new Error("detached");
  });
  await downloadCanvasMedia("https://media.invalid/sound", "Voice", "audio");
  expect(window.open).toHaveBeenCalledWith("https://media.invalid/sound", "_blank");
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:fixture");
});
it("keeps delayed revocation and explicit filenames on a successful download", async () => {
  await downloadCanvasMedia("https://media.invalid/sound", "Voice.ogg", "audio");
  expect(names).toEqual(["Voice.ogg"]);
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:fixture");
  expect(window.open).not.toHaveBeenCalled();
});
it("opens the original source after an HTTP failure without allocating a blob", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  await downloadCanvasMedia("https://media.invalid/sound", "Voice", "audio");
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(window.open).toHaveBeenCalledWith("https://media.invalid/sound", "_blank");
});
it("reports a blocked fallback instead of silent completion", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("network"));
  await expect(downloadCanvasMedia("/media", "Work", "image")).resolves.toBe("failed");
});
it("reports an opened fallback separately from a download start", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("network"));
  vi.mocked(window.open).mockReturnValue({} as Window);
  await expect(downloadCanvasMedia("/media", "Work", "image")).resolves.toBe("opened");
});
it("handles a throwing fallback without an unhandled rejection", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("network"));
  vi.mocked(window.open).mockImplementation(() => {
    throw new Error("blocked");
  });
  await expect(downloadCanvasMedia("/media", "Work", "image")).resolves.toBe("failed");
});
it("does not fetch or open an absent source", async () => {
  await expect(downloadCanvasMedia("", "Work", "image")).resolves.toBe("failed");
  expect(fetch).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
});
it("reports initiation, not completion on disk", async () => {
  await expect(downloadCanvasMedia("/media", "Work", "audio")).resolves.toBe("started");
});

it.each([false, true])(
  "cancels failed download streams and retains fallback (cleanup rejects: %s)",
  async (rejectCleanup) => {
    const cancel = vi.fn(() =>
      rejectCleanup ? Promise.reject(new Error("cleanup failed")) : undefined
    );
    const stream = new ReadableStream({ cancel });
    vi.mocked(fetch).mockResolvedValue(new Response(stream, { status: 503 }));
    await downloadCanvasMedia("https://media.invalid/sound", "Voice", "audio");
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(window.open).toHaveBeenCalledWith("https://media.invalid/sound", "_blank");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  }
);
