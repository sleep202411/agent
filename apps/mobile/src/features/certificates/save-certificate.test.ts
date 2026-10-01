import { beforeEach, expect, it, vi } from "vitest";
import { saveCertificate } from "./save-certificate.native";
const h = vi.hoisted(() => ({
  available: vi.fn(),
  share: vi.fn(),
  write: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("expo-sharing", () => ({ isAvailableAsync: h.available, shareAsync: h.share }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  Directory: class {
    exists = true;
    create = h.create;
    delete = h.remove;
  },
  File: class {
    uri = "cache/report.xlsx";
    write = h.write;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  h.available.mockResolvedValue(true);
});
it("shares a temporary certificate image and removes it after the sheet completes", async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  await saveCertificate({ bytes, filename: "cert.png", mimeType: "image/png" }, () => true);
  expect(h.write).toHaveBeenCalledWith(bytes);
  expect(h.share).toHaveBeenCalledWith(
    "cache/report.xlsx",
    expect.objectContaining({
      mimeType: "image/png",
    })
  );
  expect(h.remove).toHaveBeenCalledOnce();
});
it("cleans up failures and prevents sharing after account changes", async () => {
  h.share.mockRejectedValue(new Error("Sharing failed"));
  await expect(
    saveCertificate(
      { bytes: new Uint8Array(), filename: "cert.png", mimeType: "image/png" },
      () => true
    )
  ).rejects.toThrow("Sharing failed");
  expect(h.remove).toHaveBeenCalledOnce();
  h.share.mockClear();
  await saveCertificate(
    { bytes: new Uint8Array(), filename: "cert.png", mimeType: "image/png" },
    () => false
  );
  expect(h.share).not.toHaveBeenCalled();
});
