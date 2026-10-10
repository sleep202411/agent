import { beforeEach, expect, it, vi } from "vitest";
import { listCreatorCertificates, publicCertificateImage } from "./creator-certificates-api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
const row = {
  id: "c1",
  certNo: "FD-GEN-2026-ABC123",
  title: "Producer",
  description: null,
  program: null,
  issuer: "FizzDragon",
  imageUrl: "https://example.com/c.png",
  issuedAt: "2026-10-01T00:00:00Z",
  validUntil: null,
};
beforeEach(() => {
  h.get.mockReset();
});
it("uses the public creator-scoped contract without credentials in URLs", async () => {
  h.get.mockResolvedValue([row]);
  const signal = new AbortController().signal;
  expect(await listCreatorCertificates("a/b", signal)).toEqual([row]);
  expect(h.get).toHaveBeenCalledWith("/certificates/users/a%2Fb", {
    service: "aurora",
    signal,
    retry: false,
  });
});
it("rejects duplicate and malformed certificates", async () => {
  h.get.mockResolvedValue([row, row]);
  await expect(listCreatorCertificates("a", new AbortController().signal)).rejects.toThrow(
    "Duplicate"
  );
  h.get.mockResolvedValue([{ ...row, issuedAt: "unknown" }]);
  await expect(listCreatorCertificates("a", new AbortController().signal)).rejects.toThrow();
});
it("preserves transport errors and distinguishes empty results", async () => {
  h.get.mockRejectedValueOnce(new Error("Registry offline"));
  await expect(listCreatorCertificates("a", new AbortController().signal)).rejects.toThrow(
    "Registry offline"
  );
  h.get.mockResolvedValue([]);
  await expect(listCreatorCertificates("a", new AbortController().signal)).resolves.toEqual([]);
});
it("discards data after cancellation", async () => {
  const c = new AbortController();
  h.get.mockImplementation(async () => {
    c.abort();
    return [row];
  });
  await expect(listCreatorCertificates("a", c.signal)).rejects.toThrow();
});
it.each([
  "javascript:alert(1)",
  "file:///x",
  "https://user:pass@example.com/c.png",
  "http://example.com/a",
  null,
])("does not open unsafe image %s", (value) => {
  expect(publicCertificateImage(value)).toBeUndefined();
});
it("accepts a public HTTPS original", () => {
  expect(publicCertificateImage(row.imageUrl)).toBe(row.imageUrl);
});
