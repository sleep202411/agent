import { beforeEach, expect, it, vi } from "vitest";
import { pickAndUploadTextAdventureMedia, textAdventureUploadFile } from "./text-adventure-upload";
const h = vi.hoisted(() => ({ pick: vi.fn(), upload: vi.fn(), generation: 1 }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("@/lib/media-upload", () => ({ uploadMobileMediaFile: h.upload }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const asset = {
  lastModified: 0,
  uri: "file:///world.docx",
  name: "world.docx",
  size: 10,
  mimeType: "application/octet-stream",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.pick.mockResolvedValue({ canceled: false, assets: [asset] });
  h.upload.mockResolvedValue({
    mediaAssetId: "11111111-1111-4111-8111-111111111111",
    url: "https://cdn.example/world.docx",
  });
});
it("uploads DOCX with the official kind, limit and confirmation checkpoint", async () => {
  const checkpoint = vi.fn();
  expect(await pickAndUploadTextAdventureMedia("document", 1, signal(), checkpoint)).toMatchObject({
    name: "world.docx",
  });
  expect(h.upload).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    expect.objectContaining({
      kind: "agent_attachment_document",
      maxBytes: 10 * 1024 * 1024,
      beforeConfirm: checkpoint,
    })
  );
  expect(h.pick).toHaveBeenCalledWith(
    expect.objectContaining({ multiple: false, base64: false, copyToCacheDirectory: true })
  );
});
it.each(["poster", "still", "music"] as const)("uses the official %s policy", (target) => {
  const music = target === "music";
  const result = textAdventureUploadFile(target, {
    ...asset,
    name: music ? "theme.mp3" : "image.png",
    mimeType: music ? "audio/mpeg" : "image/png",
  });
  expect(result.policy.kind).toBe(
    target === "poster"
      ? "episode_cover"
      : target === "still"
        ? "ai_reference_image"
        : "story_music_audio"
  );
  expect(result.policy.maxBytes).toBe(
    (target === "poster" ? 20 : target === "still" ? 30 : 50) * 1024 * 1024
  );
});
it.each([
  { ...asset, name: "world.pdf" },
  { ...asset, mimeType: "application/pdf" },
  { ...asset, size: 0 },
  { ...asset, size: 11 * 1024 * 1024 },
])("rejects invalid source document before upload", async (candidate) => {
  h.pick.mockResolvedValue({ canceled: false, assets: [candidate] });
  await expect(pickAndUploadTextAdventureMedia("document", 1, signal())).rejects.toThrow();
  expect(h.upload).not.toHaveBeenCalled();
});
it("does not write on picker cancellation or late account change", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  expect(await pickAndUploadTextAdventureMedia("document", 1, signal())).toBeNull();
  h.pick.mockImplementation(async () => {
    h.generation = 2;
    return { canceled: false, assets: [asset] };
  });
  await expect(pickAndUploadTextAdventureMedia("document", 1, signal())).rejects.toThrow("account");
  expect(h.upload).not.toHaveBeenCalled();
});
it("rejects late and unsafe upload receipts", async () => {
  h.upload.mockResolvedValue({
    mediaAssetId: "11111111-1111-4111-8111-111111111111",
    url: "https://user:secret@cdn.example/file",
  });
  await expect(pickAndUploadTextAdventureMedia("document", 1, signal())).rejects.toThrow();
  h.upload.mockImplementation(async () => {
    h.generation = 2;
    return {};
  });
  await expect(pickAndUploadTextAdventureMedia("document", 1, signal())).rejects.toThrow("account");
});
it("allows an unknown picker size for the uploader's actual-byte check", () => {
  expect(
    textAdventureUploadFile("document", { ...asset, size: undefined }).file.size
  ).toBeUndefined();
});
it("does not open the picker for an aborted operation", async () => {
  const c = new AbortController();
  c.abort();
  await expect(pickAndUploadTextAdventureMedia("document", 1, c.signal)).rejects.toThrow();
  expect(h.pick).not.toHaveBeenCalled();
});
