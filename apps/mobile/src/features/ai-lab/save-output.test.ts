/* eslint-disable import/no-duplicates -- Test both platform implementations; Expo lint resolves the base path to native. */
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { saveOutput as web } from "./save-output";
import { saveOutput as native } from "./save-output.native";
const h = vi.hoisted(() => ({
  available: vi.fn(),
  share: vi.fn(),
  make: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
  info: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("expo-sharing", () => ({ isAvailableAsync: h.available, shareAsync: h.share }));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: h.make,
  createDownloadResumable: () => ({ downloadAsync: h.download, cancelAsync: h.cancel }),
  getInfoAsync: h.info,
  moveAsync: h.move,
  deleteAsync: h.remove,
}));
const output = { id: "../sound", type: "audio" as const, url: "https://example.test/sound" };
let click: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  h.available.mockResolvedValue(true);
  h.cancel.mockResolvedValue(undefined);
  h.download.mockResolvedValue({
    uri: "file:///cache/output",
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
  h.info.mockResolvedValue({ exists: true, isDirectory: false, size: 3 });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } })
      )
  );
  URL.createObjectURL = vi.fn().mockReturnValue("blob:media");
  URL.revokeObjectURL = vi.fn();
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("downloads the response with a safe MIME-derived filename and releases its URL", async () => {
  await web(output, new AbortController().signal, () => true);
  expect(click).toHaveBeenCalledOnce();
  const link = click.mock.instances[0] as HTMLAnchorElement;
  expect(link.download).toBe("fizzdragon-___sound.mp3");
  expect(fetch).toHaveBeenCalledWith(output.url, expect.objectContaining({ credentials: "omit" }));
  vi.runOnlyPendingTimers();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:media");
});
it.each(["text/html", "application/json", "image/png"])(
  "rejects wrong web response %s",
  async (type) => {
    vi.mocked(fetch).mockResolvedValue(new Response("bad", { headers: { "content-type": type } }));
    await expect(web(output, new AbortController().signal, () => true)).rejects.toThrow();
    expect(click).not.toHaveBeenCalled();
  }
);
it("does not save a failed, empty or stale web response", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response("bad", { status: 403 }));
  await expect(web(output, new AbortController().signal, () => true)).rejects.toThrow("403");
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response("", { headers: { "content-type": "audio/mpeg" } })
  );
  await expect(web(output, new AbortController().signal, () => true)).rejects.toThrow();
  await web(output, new AbortController().signal, () => false);
  expect(click).not.toHaveBeenCalled();
});
it("shares a native file and cleans its private temporary directory", async () => {
  await native(output, new AbortController().signal, () => true);
  expect(h.move).toHaveBeenCalledWith(
    expect.objectContaining({ to: expect.stringMatching(/fizzdragon-___sound.mp3$/) })
  );
  expect(h.share).toHaveBeenCalledWith(expect.stringMatching(/\.mp3$/), { mimeType: "audio/mpeg" });
  expect(h.remove).toHaveBeenCalledOnce();
});
it("rejects native HTTP errors and removes downloaded error pages", async () => {
  h.download.mockResolvedValue({ uri: "file:///cache/output", status: 403, headers: {} });
  await expect(native(output, new AbortController().signal, () => true)).rejects.toThrow("403");
  expect(h.share).not.toHaveBeenCalled();
  expect(h.remove).toHaveBeenCalledOnce();
});
it("never shares after the owning screen/session expires", async () => {
  let current = true;
  h.download.mockImplementation(async () => {
    current = false;
    return { uri: "file:///cache/output", status: 200, headers: { "content-type": "audio/mpeg" } };
  });
  await native(output, new AbortController().signal, () => current);
  expect(h.share).not.toHaveBeenCalled();
  expect(h.remove).toHaveBeenCalledOnce();
});
it("cancels native transfer on abort and cleans partial files", async () => {
  const controller = new AbortController();
  h.download.mockImplementation(async () => {
    controller.abort();
    return undefined;
  });
  await expect(native(output, controller.signal, () => true)).rejects.toThrow();
  expect(h.cancel).toHaveBeenCalledOnce();
  expect(h.share).not.toHaveBeenCalled();
  expect(h.remove).toHaveBeenCalledOnce();
});
it.each(["file:///secret", "javascript:alert(1)", "https://user:pass@example.test/x"])(
  "rejects invalid source %s",
  async (url) => {
    await expect(
      web({ ...output, url }, new AbortController().signal, () => true)
    ).rejects.toThrow();
    await expect(
      native({ ...output, url }, new AbortController().signal, () => true)
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    expect(h.download).not.toHaveBeenCalled();
  }
);
