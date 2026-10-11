import { beforeEach, expect, it, vi } from "vitest";
import { pickAndUploadCrewFile, discardCrewUpload } from "./upload";
const h = vi.hoisted(() => ({ context: vi.fn(), pick: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("./api", () => ({ fetchCrewAssetContext: h.context }));
vi.mock("@/lib/media-upload", () => ({ uploadMobileMediaFile: h.upload }));
vi.mock("@/lib/api-client", () => ({ api: { delete: h.remove } }));
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  h.context.mockResolvedValue({
    storageAvailable: true,
    capabilities: { upload: true },
    maxUploadBytes: 100,
  });
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///a", name: "a.pdf", size: 10, mimeType: "application/pdf" }],
  });
  h.upload.mockResolvedValue({ mediaAssetId: id, url: "not retained" });
});
it("checks capabilities then uploads with Crew scope and the authoritative byte limit", async () => {
  const signal = new AbortController().signal;
  await expect(pickAndUploadCrewFile("crew", signal)).resolves.toEqual({
    source: "upload",
    mediaAssetId: id,
    name: "a.pdf",
  });
  expect(h.upload).toHaveBeenCalledWith(expect.objectContaining({ name: "a.pdf" }), {
    kind: "crew_asset_file",
    scope: { crewId: "crew" },
    maxBytes: 100,
    beforeConfirm: expect.any(Function),
    signal,
  });
});
it("does not pick when storage or permission is unavailable", async () => {
  h.context.mockResolvedValue({ storageAvailable: false, capabilities: { upload: true } });
  await expect(pickAndUploadCrewFile("crew", new AbortController().signal)).rejects.toThrow(
    "not available"
  );
  expect(h.pick).not.toHaveBeenCalled();
});
it("does not upload a cancelled picker, oversized file, or cancelled scope", async () => {
  const c = new AbortController();
  h.pick.mockResolvedValueOnce({ canceled: true });
  await expect(pickAndUploadCrewFile("crew", c.signal)).resolves.toBeNull();
  h.pick.mockResolvedValueOnce({ canceled: false, assets: [{ name: "a", size: 101 }] });
  await expect(pickAndUploadCrewFile("crew", c.signal)).rejects.toThrow("size");
  c.abort();
  await expect(pickAndUploadCrewFile("crew", c.signal)).rejects.toThrow();
  expect(h.upload).not.toHaveBeenCalled();
});
it("discards by media ID through the existing Crew endpoint", async () => {
  await discardCrewUpload("crew", id);
  expect(h.remove).toHaveBeenCalledWith(`/crews/crew/assets/uploads/${id}`, { service: "aurora" });
});

it("passes the exact confirmation and selected name to recovery storage", async () => {
  const save = vi.fn();
  const request = {
    storageKey: "key",
    kind: "crew_asset_file",
    scope: { crewId: "crew" },
    contentType: "application/pdf",
  };
  h.upload.mockImplementation(async (_file, options) => {
    options.beforeConfirm(request);
    return { mediaAssetId: id };
  });
  await pickAndUploadCrewFile("crew", new AbortController().signal, save);
  expect(save).toHaveBeenCalledWith(request, "a.pdf");
});
