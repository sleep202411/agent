import { afterEach, expect, it, vi } from "vitest";
import { verifyCertificate } from "./api";
afterEach(() => vi.unstubAllGlobals());
it.each([
  ['{"message":"Certificate service unavailable"}', "Certificate service unavailable"],
  ["Verification service unavailable", "Verification service unavailable"],
  ['{"msg":"Invalid certificate issuer"}', "Invalid certificate issuer"],
  ['{"message":["Invalid number","Invalid issuer"]}', "Invalid number; Invalid issuer"],
])("preserves the upstream body %s", async (body, message) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(body, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(verifyCertificate("FD/A")).rejects.toMatchObject({ status: 503, message });
  expect(fetcher.mock.calls[0][0]).toContain("certNo=FD%2FA");
});
