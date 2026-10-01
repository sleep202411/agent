import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { verifyCertificate } from "./verify-api";
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
const number = "FD-OPC-2605-8K3Q7P";
const cert = {
  id: "1",
  certNo: number,
  title: "Qualification",
  issuer: "FizzDragon",
  imageUrl: null,
  issuedAt: "2026-05-01T00:00:00Z",
  revokedAt: null,
  revokedReason: null,
};
beforeEach(() => vi.resetAllMocks());
it.each(["valid", "revoked", "not_found"] as const)(
  "reads public %s results with normalized numbers",
  async (status) => {
    const result = {
      certNo: number,
      status,
      valid: status === "valid",
      certificate: status === "not_found" ? null : cert,
    };
    vi.mocked(api.get).mockResolvedValue(result);
    const signal = new AbortController().signal;
    expect(await verifyCertificate(` ${number.toLowerCase()} `, signal)).toEqual(result);
    expect(api.get).toHaveBeenCalledWith("/certificates/verify", {
      service: "aurora",
      params: { certNo: number },
      signal,
      retry: false,
    });
  }
);
it("rejects malformed input without consuming a rate-limited request", async () => {
  await expect(verifyCertificate("bad", new AbortController().signal)).rejects.toThrow("format");
  expect(api.get).not.toHaveBeenCalled();
});
it.each([
  { certNo: "OTHER", valid: true, status: "valid", certificate: cert },
  { certNo: number, valid: true, status: "revoked", certificate: cert },
  { certNo: number, valid: true, status: "valid", certificate: null },
])("rejects mismatched results", async (result) => {
  vi.mocked(api.get).mockResolvedValue(result);
  await expect(verifyCertificate(number, new AbortController().signal)).rejects.toThrow();
});
it("preserves actionable server errors", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("Too many requests"));
  await expect(verifyCertificate(number, new AbortController().signal)).rejects.toThrow(
    "Too many requests"
  );
});
