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
