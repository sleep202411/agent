// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadMediaFile, inferDownloadFilename, triggerBlobDownload } from "./media-download";

function mockFetchResponse(blob: Blob, init?: ResponseInit) {
  return vi.fn().mockResolvedValue(new Response(blob, { status: 200, ...init }));
}

describe("inferDownloadFilename", () => {
  it("uses the URL basename when it carries an extension", () => {
    expect(inferDownloadFilename("https://cdn.example.test/a/b/poster.png")).toBe("poster.png");
  });

  it("ignores query strings and hash fragments", () => {
    expect(inferDownloadFilename("https://cdn.example.test/key.mp4?sign=abc&x=1#frag")).toBe(
      "key.mp4"
    );
  });

  it("fills the extension from the mime type when the URL has none", () => {
    expect(inferDownloadFilename("https://cdn.example.test/media/xyz", "video/mp4")).toBe(
      "download.mp4"
    );
  });

  it("prefers the explicit name and appends the mime extension", () => {
    expect(
      inferDownloadFilename("https://cdn.example.test/a/b/img.png", "image/png", "shot-3")
    ).toBe("shot-3.png");
  });

  it("falls back to `download` with no mime hint", () => {
    expect(inferDownloadFilename("https://cdn.example.test/no-ext")).toBe("download");
  });

  it("strips path separators and control characters", () => {
    expect(inferDownloadFilename("", undefined, "../../etc/passwd")).toBe("etc passwd");
    expect(inferDownloadFilename("", undefined, "bad\u0000name.png")).toBe("badname.png");
  });

  it("keeps the mime extension when sanitizing removes a fake extension", () => {
    expect(inferDownloadFilename("", "image/jpeg", "photo.")).toBe("photo.jpg");
  });

  it("caps runaway names without losing the extension", () => {
    const long = `${"a".repeat(300)}.png`;
    const result = inferDownloadFilename("https://cdn.example.test/a.png", "image/png", long);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith(".png")).toBe(true);
  });
});

describe("downloadMediaFile", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let click: ReturnType<typeof vi.spyOn>;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    createObjectURL = vi.fn(() => "blob:media-download-test");
    revokeObjectURL = vi.fn();
    // jsdom ships no blob-URL support, so patch the statics in place —
    // spreading `URL` into a stub would lose constructability (`new URL`).
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("saves the fetched blob under the derived filename", async () => {
    const fetchMock = mockFetchResponse(new Blob(["bytes"], { type: "image/png" }));
    vi.stubGlobal("fetch", fetchMock);

    const saved = await downloadMediaFile("https://cdn.example.test/frame.png");

    expect(saved).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.test/frame.png", {
      signal: undefined,
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("frame.png");
    expect(anchor.href).toBe("blob:media-download-test");
  });

  it("honors an explicit filename with the mime extension filled in", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchResponse(new Blob(["bytes"]), {
        headers: { "Content-Type": "video/mp4" },
      })
    );

    await downloadMediaFile("https://cdn.example.test/xyz", { filename: "shot-1" });

    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("shot-1.mp4");
  });

  it("revokes the object URL only after a delay", async () => {
    vi.stubGlobal("fetch", mockFetchResponse(new Blob(["bytes"], { type: "image/png" })));

    await downloadMediaFile("https://cdn.example.test/a.png");
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:media-download-test");
  });

  it("returns false on a non-2xx response without touching the DOM", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));

    const saved = await downloadMediaFile("https://cdn.example.test/gone.png");

    expect(saved).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it.each([false, true])("cancels unread error bodies even when cancellation rejects: %s", async (rejectCancel) => {
    const cancel = vi.fn(() => rejectCancel ? Promise.reject(new Error("cleanup failed")) : undefined);
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 503 })));

    await expect(downloadMediaFile("https://cdn.example.test/unavailable.mp4")).resolves.toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("returns false when the fetch rejects (CORS / network)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(downloadMediaFile("https://cdn.example.test/blocked.png")).resolves.toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("rethrows when the caller aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));

    await expect(
      downloadMediaFile("https://cdn.example.test/a.png", { signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("triggerBlobDownload", () => {
  it("clicks an anchor with the blob URL and filename", () => {
    const createObjectURL = vi.fn(() => "blob:trigger-test");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.useFakeTimers();

    try {
      triggerBlobDownload(new Blob(["x"]), "clip.mp4");
      const anchor = click.mock.instances[0] as HTMLAnchorElement;
      expect(anchor.download).toBe("clip.mp4");
      expect(anchor.href).toBe("blob:trigger-test");
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledOnce();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});
