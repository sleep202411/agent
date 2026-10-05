import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  fetchCaseEvidence,
  pickCaseEvidence,
  uploadCaseEvidence,
  confirmCaseEvidence,
  readCaseEvidence,
  evidenceUrl,
  type CaseUpload,
} from "./case-evidence-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  pick: vi.fn(),
  fetch: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "00000000-0000-4000-8000-000000000002" },
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const signal = () => new AbortController().signal;
const expiry = () => new Date(Date.now() + 60000).toISOString();
const upload = (): CaseUpload => ({
  id: id(2),
  file: new Blob(["abc"], { type: "application/pdf" }),
  metadata: { name: "proof.pdf", contentType: "application/pdf", sizeBytes: 3 },
  uploaded: false,
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.stubGlobal("fetch", h.fetch);
  h.fetch.mockResolvedValue({ ok: true });
  h.post.mockImplementation(async (path: string) =>
    path.endsWith("/confirm")
      ? { id: id(2) }
      : { url: "https://storage.example/upload", method: "PUT", headers: {}, expiresAt: expiry() }
  );
});
afterEach(() => vi.unstubAllGlobals());
it("picks exactly one allowed file, using its actual byte size", async () => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ name: "proof.pdf", mimeType: "application/pdf", size: 3, file: upload().file }],
  });
  expect((await pickCaseEvidence(1, signal()))?.metadata.sizeBytes).toBe(3);
  h.pick.mockResolvedValue({ canceled: true });
  expect(await pickCaseEvidence(1, signal())).toBeNull();
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ name: "bad.txt", mimeType: "text/plain", file: new Blob(["bad"]) }],
  });
  await expect(pickCaseEvidence(1, signal())).rejects.toThrow();
});
it("rejects oversized files before loading their bytes and forbidden filename characters", async () => {
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ name: "proof.pdf", size: 11 * 1024 * 1024 }],
  });
  await expect(pickCaseEvidence(1, signal())).rejects.toThrow("10 MB");
  expect(h.fetch).not.toHaveBeenCalled();
  await expect(
    uploadCaseEvidence(
      id(1),
      { ...upload(), metadata: { ...upload().metadata, name: 'bad"name.pdf' } },
      1,
      signal()
    )
  ).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("uploads without credentials and recovers lost confirmation without another PUT", async () => {
  const item = upload();
  h.post
    .mockImplementationOnce(async () => ({
      url: "https://storage.example/upload",
      method: "PUT",
      headers: {},
      expiresAt: expiry(),
    }))
    .mockRejectedValueOnce(Error("Confirmation lost"))
    .mockResolvedValue({ id: id(2) });
  await expect(uploadCaseEvidence(id(1), item, 1, signal())).rejects.toThrow("Confirmation lost");
  expect(item.uploaded).toBe(true);
  await uploadCaseEvidence(id(1), item, 1, signal());
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.fetch).toHaveBeenCalledWith(
    "https://storage.example/upload",
    expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer", method: "PUT" })
  );
  expect(h.post.mock.calls[0]![1].retry).toBe(false);
});
it("rejects non-HTTPS, expired or credential-bearing placements", async () => {
  for (const patch of [
    { url: "http://storage.example/file" },
    { url: "https://user:password@storage.example/file" },
    { expiresAt: "2000-01-01T00:00:00Z" },
    { headers: { Authorization: "secret" } },
  ]) {
    h.post.mockResolvedValue({
      url: "https://storage.example/file",
      method: "PUT",
      expiresAt: expiry(),
      headers: {},
      ...patch,
    });
    await expect(uploadCaseEvidence(id(1), upload(), 1, signal())).rejects.toThrow();
  }
  expect(h.fetch).not.toHaveBeenCalled();
});
it("validates confirmation identity and signed read expiry", async () => {
  h.post.mockResolvedValue({ id: id(3) });
  await expect(confirmCaseEvidence(id(1), id(2), 1, signal())).rejects.toThrow("receipt");
  h.get.mockResolvedValue({ url: "https://storage.example/read", expiresAt: expiry() });
  expect((await readCaseEvidence(id(1), id(2), 1, signal())).url).toContain("https:");
  expect(() =>
    evidenceUrl({ url: "https://storage.example/read", expiresAt: "2000-01-01T00:00:00Z" })
  ).toThrow();
});
it("rejects duplicate list entries, stalled cursors and account changes", async () => {
  const row = {
    id: id(2),
    ...upload().metadata,
    ready: true,
    shared: false,
    createdAt: new Date().toISOString(),
  };
  h.get.mockResolvedValue({ items: [row, row], nextBeforeId: null });
  await expect(fetchCaseEvidence(id(1), 1, null, signal())).rejects.toThrow("pagination");
  h.get.mockResolvedValue({ items: [row], nextBeforeId: id(3) });
  await expect(fetchCaseEvidence(id(1), 1, id(3), signal())).rejects.toThrow("pagination");
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { items: [row], nextBeforeId: null };
  });
  await expect(fetchCaseEvidence(id(1), 1, null, signal())).rejects.toThrow("expired");
});

it("uploads initial private evidence under the task and future case, then confirms by identity", async () => {
  await uploadCaseEvidence(id(1), upload(), 1, signal(), id(3));
  expect(h.post.mock.calls.map((call) => call[0])).toEqual([
    `/crew-tasks/${id(3)}/dispute-drafts/${id(1)}/attachments/${id(2)}`,
    `/crew-tasks/${id(3)}/dispute-drafts/${id(1)}/attachments/${id(2)}/confirm`,
  ]);
});
