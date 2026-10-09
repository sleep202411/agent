import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./api-client";
import { uploadMobileMediaFile } from "./media-upload";
vi.mock("./api-client", () => ({ api: { post: vi.fn() } }));
const fetchMock = vi.fn();
const file = { uri: "file:///local.pdf", name: "local.pdf", type: "application/pdf", size: 999 };
const signed = {
  uploadUrl: "https://storage.example/signed",
  method: "PUT",
  headers: { "x-storage-header": "required" },
  storageKey: "issued-key",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["1234"], { type: "application/pdf" }),
    })
    .mockResolvedValueOnce({ ok: true });
  vi.mocked(api.post)
    .mockResolvedValueOnce(signed)
    .mockResolvedValueOnce({ mediaAssetId: "media", url: "https://cdn.example/file" });
});
afterEach(() => vi.unstubAllGlobals());
it("signs actual bytes and echoes Crew scope through confirmation without leaking auth into storage", async () => {
  const signal = new AbortController().signal;
  await expect(
    uploadMobileMediaFile(file, { kind: "crew_asset_file", scope: { crewId: " crew " }, signal })
  ).resolves.toEqual({ mediaAssetId: "media", url: "https://cdn.example/file" });
  expect(api.post).toHaveBeenNthCalledWith(1, "/media/upload-url", {
    service: "aurora",
    signal,
    data: {
      kind: "crew_asset_file",
      contentType: "application/pdf",
      fileName: "local.pdf",
      sizeBytes: 4,
      scope: { crewId: "crew" },
    },
  });
  expect(api.post).toHaveBeenNthCalledWith(2, "/media/confirm", {
    service: "aurora",
    signal,
    data: {
      kind: "crew_asset_file",
      contentType: "application/pdf",
      storageKey: "issued-key",
      scope: { crewId: "crew" },
    },
  });
  expect(fetchMock).toHaveBeenNthCalledWith(1, file.uri, { signal });
  expect(fetchMock).toHaveBeenNthCalledWith(2, signed.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf", ...signed.headers },
    body: expect.any(Blob),
    signal,
  });
});
it("supports an omitted picker size and MIME without inventing an image type", async () => {
  await uploadMobileMediaFile(
    { ...file, type: "", size: undefined },
    { kind: "ip_audience_reference" }
  );
  expect(vi.mocked(api.post).mock.calls[0][1]?.data).toMatchObject({
    sizeBytes: 4,
    contentType: "application/pdf",
  });
  expect(vi.mocked(api.post).mock.calls[0][1]?.data).not.toHaveProperty("scope");
});
it("rejects missing Crew scope before reserving storage", async () => {
  await expect(uploadMobileMediaFile(file, { kind: "crew_asset_file" })).rejects.toThrow("scope");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["unreadable", "empty"])("does not sign an %s local file", async (mode) => {
  fetchMock
    .mockReset()
    .mockResolvedValue({ ok: mode !== "unreadable", status: 404, blob: async () => new Blob([]) });
  await expect(uploadMobileMediaFile(file, { kind: "ip_audience_reference" })).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("does not confirm a failed storage PUT", async () => {
  fetchMock
    .mockReset()
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["data"]) })
    .mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(uploadMobileMediaFile(file, { kind: "ip_audience_reference" })).rejects.toThrow(
    "503"
  );
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("stops after local reading if cancellation happened during blob resolution", async () => {
  const controller = new AbortController();
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    blob: async () => {
      controller.abort();
      return new Blob(["data"]);
    },
  });
  await expect(
    uploadMobileMediaFile(file, { kind: "ip_audience_reference", signal: controller.signal })
  ).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});

it("rejects actual oversized bytes before reserving storage", async () => {
  await expect(
    uploadMobileMediaFile(file, { kind: "crew_asset_file", scope: { crewId: "crew" }, maxBytes: 3 })
  ).rejects.toThrow("allowed upload size");
  expect(api.post).not.toHaveBeenCalled();
});
