import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadCanvasPanorama } from "./story-canvas-panorama";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  platformRead: vi.fn(),
  read: vi.fn(),
  generation: 1,
  fetch: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./story-canvas-document", () => ({ readStoryCanvasDocument: h.read }));
vi.mock("./platform-canvas-document", () => ({ readPlatformCanvasDocument: h.platformRead }));
const id = "11111111-1111-4111-8111-111111111111",
  scope = { projectId: id, documentId: id, generation: 1 },
  source = { mediaAssetId: id, title: "Panorama" };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.stubGlobal("fetch", h.fetch);
  h.get.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]).buffer,
    contentType: "image/png",
    disposition: null,
  });
});
it("loads protected bytes after document permission without sending tokens to a remote URL", async () => {
  const signal = new AbortController().signal;
  expect(
    await loadCanvasPanorama(scope, { ...source, url: "https://external.test/image" }, signal)
  ).toBe("data:image/png;base64,AQID");
  expect(h.get).toHaveBeenCalledWith(
    `/media/assets/${id}/content`,
    expect.objectContaining({
      service: "aurora",
      responseType: "binary",
      params: { documentId: id },
      signal,
      retry: false,
    })
  );
  expect(h.read.mock.invocationCallOrder[0]).toBeLessThan(h.get.mock.invocationCallOrder[0]!);
  expect(h.fetch).not.toHaveBeenCalled();
});
it("rejects revoked access, retired sessions and non-raster responses", async () => {
  h.read.mockRejectedValueOnce(Error("Access denied"));
  await expect(loadCanvasPanorama(scope, source, new AbortController().signal)).rejects.toThrow(
    "Access denied"
  );
  expect(h.get).not.toHaveBeenCalled();
  h.get.mockImplementationOnce(async () => {
    h.generation++;
    return { bytes: new ArrayBuffer(3), contentType: "image/png" };
  });
  await expect(loadCanvasPanorama(scope, source, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
  h.generation = 1;
  h.get.mockResolvedValueOnce({ bytes: new ArrayBuffer(3), contentType: "image/svg+xml" });
  await expect(loadCanvasPanorama(scope, source, new AbortController().signal)).rejects.toThrow(
    "JPEG"
  );
});
it("loads URL-only images anonymously and rejects oversized responses before decoding", async () => {
  h.fetch.mockResolvedValue(
    new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg" } })
  );
  expect(
    await loadCanvasPanorama(
      scope,
      { title: "Image", url: "https://public.test/pano" },
      new AbortController().signal
    )
  ).toBe("data:image/jpeg;base64,AQ==");
  expect(h.fetch).toHaveBeenCalledWith(
    "https://public.test/pano",
    expect.objectContaining({
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })
  );
  h.fetch.mockResolvedValue(new Response("", { headers: { "content-length": "999999999" } }));
  await expect(
    loadCanvasPanorama(
      scope,
      { title: "Image", url: "https://public.test/pano" },
      new AbortController().signal
    )
  ).rejects.toThrow("32 MB");
  await expect(
    loadCanvasPanorama(
      scope,
      { title: "Image", url: "javascript:alert(1)" },
      new AbortController().signal
    )
  ).rejects.toThrow("Invalid");
});

afterEach(() => vi.unstubAllGlobals());

it("uses the platform document grant for panorama bytes and propagates revocation", async () => {
  const platform = { ...scope, kind: "platform" as const, workspaceId: id, sectionId: id };
  const signal = new AbortController().signal;
  expect(await loadCanvasPanorama(platform, source, signal)).toBe("data:image/png;base64,AQID");
  expect(h.platformRead).toHaveBeenCalledWith(platform, signal);
  expect(h.read).not.toHaveBeenCalled();
  h.platformRead.mockRejectedValue(Error("Access revoked"));
  h.get.mockClear();
  await expect(loadCanvasPanorama(platform, source, signal)).rejects.toThrow("Access revoked");
  expect(h.get).not.toHaveBeenCalled();
});
