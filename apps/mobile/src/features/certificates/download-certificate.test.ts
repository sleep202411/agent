import { beforeEach, expect, it, vi } from "vitest";
import { downloadCertificate } from "./download-certificate";
const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/stream-fetch", () => ({ streamFetch: h.fetch }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
const url = "https://example.com/c.png",
  certNo = "FD-GEN-2026-ABC123";
const signal = () => new AbortController().signal;
beforeEach(() => {
  h.fetch.mockReset();
});
it("downloads public image bytes with the server MIME and no session credentials", async () => {
  h.fetch.mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })
  );
  const file = await downloadCertificate(url, certNo, signal());
  expect(file).toEqual({
    bytes: new Uint8Array([1, 2, 3]),
    filename: certNo + ".png",
    mimeType: "image/png",
  });
  expect(h.fetch).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: "omit" }));
});
it.each<ResponseInit>([
  { status: 503, headers: {} },
  { status: 200, headers: { "content-type": "text/html" } },
  {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(21 * 1024 * 1024) },
  },
])("rejects unsafe or failed responses %j", async (options) => {
  h.fetch.mockResolvedValue(new Response("bad", options));
  await expect(downloadCertificate(url, certNo, signal())).rejects.toThrow();
});
it("enforces the byte limit even without content-length", async () => {
  h.fetch.mockResolvedValue(
    new Response(new Uint8Array(20 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } })
  );
  await expect(downloadCertificate(url, certNo, signal())).rejects.toThrow("20 MB");
});
it("does not download invalid URLs, identifiers or cancelled requests", async () => {
  await expect(downloadCertificate("file:///x", certNo, signal())).rejects.toThrow();
  await expect(downloadCertificate(url, "../../private", signal())).rejects.toThrow();
  const c = new AbortController();
  c.abort();
  await expect(downloadCertificate(url, certNo, c.signal)).rejects.toThrow();
  expect(h.fetch).not.toHaveBeenCalled();
});
