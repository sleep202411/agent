import { beforeEach, expect, it, vi } from "vitest";
import { referenceUpload } from "./story-reference-upload";
const h = vi.hoisted(() => ({
  generation: 1,
  pick: vi.fn(),
  upload: vi.fn(),
  confirm: vi.fn(),
  add: vi.fn(),
}));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/media-upload", () => ({
  uploadMobileMediaFile: h.upload,
  confirmMobileMediaUpload: h.confirm,
}));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("./story-references-api", () => ({ storyReferences: () => ({ addVersion: h.add }) }));
const projectId = "22222222-2222-4222-8222-222222222222",
  slotId = "33333333-3333-4333-8333-333333333333";
const mediaAssetId = "44444444-4444-4444-8444-444444444444",
  variantId = "55555555-5555-4555-8555-555555555555";
const scope = { projectId, generation: 1 };
const confirmation = {
  storageKey: "stored-object",
  kind: "ai_reference_image",
  contentType: "image/png",
  scope: { storyProjectId: projectId },
};
const receipt = { mediaAssetId, variantId, url: "https://example.com/image.png" };
const file = { uri: "file:///image.png", name: "image.png", type: "image/png", size: 8 };
let raw: string | null;
const storage = {
  read: () => raw,
  write: vi.fn((value: string) => {
    raw = value;
  }),
};
const signal = () => new AbortController().signal;
const store = () => referenceUpload(scope, "user", storage);
beforeEach(() => {
  vi.resetAllMocks();
  raw = null;
  h.generation = 1;
  storage.write.mockImplementation((value) => {
    raw = value;
  });
  h.pick.mockResolvedValue({ canceled: false, assets: [{ ...file, mimeType: file.type }] });
  h.upload.mockImplementation(async (_file, options) => {
    options.beforeConfirm(confirmation);
    return receipt;
  });
  h.confirm.mockResolvedValue(receipt);
  h.add.mockResolvedValue({ id: "version" });
});
it("uploads into the project, saves recovery before confirmation and registers the original slot version", async () => {
  h.add.mockImplementation(async () => {
    expect(raw).toContain("stored-object");
    return { id: "version" };
  });
  const client = store();
  expect(await client.pick(slotId, 3, signal())).toEqual({ id: "version" });
  expect(h.upload.mock.calls[0][1]).toMatchObject({
    scope: { storyProjectId: projectId },
    maxBytes: 30 * 1024 * 1024,
  });
  expect(h.add.mock.calls[0]).toEqual([
    slotId,
    { expectedSlotVersion: 3, source: "upload", assetId: mediaAssetId, variantId },
    "11111111-1111-4111-8111-111111111111",
    expect.any(AbortSignal),
  ]);
  expect(client.read()).toBeNull();
});
it("recovers confirmation after reopening without reuploading bytes", async () => {
  h.upload.mockImplementation(async (_file, options) => {
    options.beforeConfirm(confirmation);
    throw Error("Confirmation timed out");
  });
  await expect(store().pick(slotId, 3, signal())).rejects.toThrow("timed out");
  const reopened = store();
  expect(reopened.read()?.slotId).toBe(slotId);
  await reopened.resume(signal());
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.confirm).toHaveBeenCalledWith(confirmation, expect.any(AbortSignal));
  expect(reopened.read()).toBeNull();
});
it("retries the exact registration after a lost response", async () => {
  h.add.mockRejectedValueOnce(Error("Response lost"));
  const client = store();
  await expect(client.upload(slotId, 7, file, signal())).rejects.toThrow("Response lost");
  await client.resume(signal());
  expect(h.add.mock.calls[1].slice(0, 3)).toEqual(h.add.mock.calls[0].slice(0, 3));
  expect(h.upload).toHaveBeenCalledTimes(1);
});
it("keeps conflict recovery until explicitly discarded and prevents another upload", async () => {
  h.add.mockRejectedValue(Error("Slot version conflict"));
  const client = store();
  await expect(client.upload(slotId, 2, file, signal())).rejects.toThrow("conflict");
  await expect(client.pick(slotId, 3, signal())).rejects.toThrow("pending");
  expect(h.pick).not.toHaveBeenCalled();
  expect(() => client.clear("wrong-key")).toThrow();
  client.clear(client.read()!.clientKey);
  expect(client.read()).toBeNull();
});
it("retains confirmation when the server does not provide a variant", async () => {
  h.upload.mockImplementation(async (_file, options) => {
    options.beforeConfirm(confirmation);
    return { mediaAssetId };
  });
  const client = store();
  await expect(client.upload(slotId, 0, file, signal())).rejects.toThrow();
  expect(client.read()).not.toBeNull();
  expect(h.add).not.toHaveBeenCalled();
});
it("rejects confirmation belonging to a different project before registration", async () => {
  h.upload.mockImplementation(async (_file, options) => {
    options.beforeConfirm({ ...confirmation, scope: { storyProjectId: slotId } });
    return receipt;
  });
  await expect(store().upload(slotId, 0, file, signal())).rejects.toThrow();
  expect(raw).toBeNull();
  expect(h.add).not.toHaveBeenCalled();
});
it.each([
  { ...file, type: "video/mp4" },
  { ...file, size: 0 },
  { ...file, size: 31 * 1024 * 1024 },
])("rejects invalid images before uploading", async (invalid) => {
  await expect(store().upload(slotId, 0, invalid, signal())).rejects.toThrow();
  expect(h.upload).not.toHaveBeenCalled();
});
it("does not upload a picker result after account change", async () => {
  h.pick.mockImplementation(async () => {
    h.generation = 2;
    return { canceled: false, assets: [file] };
  });
  await expect(store().pick(slotId, 0, signal())).rejects.toThrow("session expired");
  expect(h.upload).not.toHaveBeenCalled();
});
it("retains recovery on cancellation after upload", async () => {
  const c = new AbortController();
  h.upload.mockImplementation(async (_file, options) => {
    options.beforeConfirm(confirmation);
    c.abort();
    return receipt;
  });
  const client = store();
  await expect(client.upload(slotId, 0, file, c.signal)).rejects.toThrow();
  expect(client.read()).not.toBeNull();
  expect(h.add).not.toHaveBeenCalled();
});
it("prevents simultaneous pickers and discard during an active operation", async () => {
  let finish!: (result: { canceled: boolean }) => void;
  h.pick.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const client = store(),
    first = client.pick(slotId, 0, signal());
  await expect(client.pick(slotId, 0, signal())).rejects.toThrow("already running");
  expect(() => client.clear("key")).toThrow("Wait");
  finish({ canceled: true });
  expect(await first).toBeNull();
  expect(h.upload).not.toHaveBeenCalled();
});
