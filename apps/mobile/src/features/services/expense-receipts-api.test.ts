import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchExpenseReceipts,
  pickExpenseReceipt,
  uploadExpenseReceipt,
} from "./expense-receipts-api";
const h = vi.hoisted(() => ({ generation: 1, pick: vi.fn(), fetch: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: h.pick }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const id = "11111111-1111-4111-8111-111111111111",
  draft = "22222222-2222-4222-8222-222222222222";
const signal = () => new AbortController().signal;
const file = () => new Blob(["pdf"], { type: "application/pdf" });
const upload = () => ({
  id,
  file: file(),
  metadata: { name: "receipt.pdf", contentType: "application/pdf" as const, sizeBytes: 3 },
  uploaded: false,
});
const signed = {
  method: "PUT",
  url: "https://storage.example.com/upload",
  headers: { "x-upload": "yes" },
  expiresAt: "2099-01-01T00:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.stubGlobal("fetch", h.fetch);
  h.pick.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file:///receipt.pdf", name: "receipt.pdf", mimeType: "application/pdf" }],
  });
  h.fetch.mockResolvedValue({ ok: true, blob: async () => file() });
  vi.mocked(api.post).mockResolvedValueOnce(signed).mockResolvedValue({ id });
});
it("uses real bytes when picker omits size", async () => {
  expect(await pickExpenseReceipt(1, signal())).toMatchObject({
    id,
    metadata: { sizeBytes: 3, contentType: "application/pdf" },
    uploaded: false,
  });
  expect(api.post).not.toHaveBeenCalled();
});
it("cancellation never reserves storage", async () => {
  h.pick.mockResolvedValue({ canceled: true });
  expect(await pickExpenseReceipt(1, signal())).toBeNull();
  expect(h.fetch).not.toHaveBeenCalled();
});
it.each([{ name: "../receipt.pdf" }, { mimeType: "text/html" }, { size: 10485761 }])(
  "rejects invalid file %j",
  async (change) => {
    h.pick.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file:///receipt.pdf", name: "receipt.pdf", mimeType: "application/pdf", ...change },
      ],
    });
    await expect(pickExpenseReceipt(1, signal())).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  }
);
it("uploads privately and confirms scoped identity", async () => {
  await expect(uploadExpenseReceipt("crew", draft, upload(), 1, signal())).resolves.toEqual({
    id,
    name: "receipt.pdf",
  });
  expect(h.fetch).toHaveBeenCalledWith(
    signed.url,
    expect.objectContaining({
      method: "PUT",
      credentials: "omit",
      headers: { "Content-Type": "application/pdf", "x-upload": "yes" },
    })
  );
  expect(api.post).toHaveBeenLastCalledWith(
    `/crews/crew/expense-drafts/${draft}/receipts/${id}/confirm`,
    expect.objectContaining({ service: "aurora", data: {} })
  );
});
it("retry after confirm failure does not upload bytes again", async () => {
  vi.mocked(api.post)
    .mockReset()
    .mockResolvedValueOnce(signed)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue({ id });
  const pending = upload();
  await expect(uploadExpenseReceipt("crew", draft, pending, 1, signal())).rejects.toThrow(
    "Offline"
  );
  expect(pending.uploaded).toBe(true);
  await uploadExpenseReceipt("crew", draft, pending, 1, signal());
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledTimes(3);
});
it.each([
  { method: "POST" },
  { url: "http://storage.example.com/upload" },
  { url: "https://user:pass@storage.example.com/upload" },
  { expiresAt: "2000-01-01T00:00:00Z" },
  { headers: { Authorization: "secret" } },
])("rejects unsafe upload placement %j", async (change) => {
  vi.mocked(api.post)
    .mockReset()
    .mockResolvedValue({ ...signed, ...change });
  await expect(uploadExpenseReceipt("crew", draft, upload(), 1, signal())).rejects.toThrow();
  expect(h.fetch).not.toHaveBeenCalled();
});
it("rejects wrong confirmation identity", async () => {
  vi.mocked(api.post).mockReset().mockResolvedValueOnce(signed).mockResolvedValue({ id: draft });
  await expect(uploadExpenseReceipt("crew", draft, upload(), 1, signal())).rejects.toThrow(
    "does not match"
  );
});
it("does not upload after account change", async () => {
  vi.mocked(api.post)
    .mockReset()
    .mockImplementation(async () => {
      h.generation = 2;
      return signed;
    });
  await expect(uploadExpenseReceipt("crew", draft, upload(), 1, signal())).rejects.toThrow(
    "session"
  );
  expect(h.fetch).not.toHaveBeenCalled();
});
it("validates receipt pagination", async () => {
  vi.mocked(api.get).mockResolvedValue({ items: [{ id, name: "r.pdf" }], nextCursor: null });
  expect((await fetchExpenseReceipts("crew", draft, null, signal())).items).toHaveLength(1);
  vi.mocked(api.get).mockResolvedValue({ items: [], nextCursor: id });
  await expect(fetchExpenseReceipts("crew", draft, id, signal())).rejects.toThrow("pagination");
});
