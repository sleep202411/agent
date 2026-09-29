import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { createAgreement } from "./agreement-create-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
const record = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  memberUserId: "user",
  signerName: "Artist",
  signerEmail: "artist@example.com",
  title: "Production Agreement",
  provider: "boldsign" as const,
  providerStatus: null,
  providerDocumentId: "provider-document",
  status: "sent" as const,
  capabilities: { sign: true },
  delivery: { status: "completed" as const, error: null, attempt: 1, canRetry: false },
  archive: {
    status: "not_applicable" as const,
    canRetry: false,
    signedDocumentUrl: null,
    auditTrailUrl: null,
  },
  sentAt: "2026-09-30T00:00:00Z",
  signedAt: null,
  lastSyncedAt: null,
  voidedAt: null,
  createdAt: "2026-09-30T00:00:00Z",
  updatedAt: "2026-09-30T00:00:00Z",
};

const input = {
  memberUserId: "user",
  signerName: " Artist ",
  signerEmail: " Artist@Example.COM ",
  title: " Production Agreement ",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  vi.mocked(api.post).mockResolvedValue(record);
});
it("queues trimmed terms and accepts normalized email", async () => {
  await expect(createAgreement("crew", input, 1)).resolves.toEqual(record);
  expect(api.post).toHaveBeenCalledExactlyOnceWith("/crews/crew/agreements", {
    service: "aurora",
    data: {
      memberUserId: "user",
      signerName: "Artist",
      signerEmail: "Artist@Example.COM",
      title: "Production Agreement",
    },
  });
});
it.each([
  { signerEmail: "invalid" },
  { memberUserId: "" },
  { signerName: " " },
  { title: "a".repeat(181) },
])("rejects invalid terms %j before sending", async (change) => {
  await expect(createAgreement("crew", { ...input, ...change }, 1)).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { crewId: "other" },
  { memberUserId: "other" },
  { signerName: "Other" },
  { signerEmail: "other@example.com" },
  { title: "Other" },
])("rejects mismatched receipt %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...record, ...change });
  await expect(createAgreement("crew", input, 1)).rejects.toThrow("receipt");
});
it("does not send after account change", async () => {
  h.generation = 2;
  await expect(createAgreement("crew", input, 1)).rejects.toThrow("Account");
  expect(api.post).not.toHaveBeenCalled();
});
it("ignores success from previous account", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return record;
  });
  await expect(createAgreement("crew", input, 1)).rejects.toThrow("Account");
});
it("preserves server rejection", async () => {
  vi.mocked(api.post).mockRejectedValue(
    new Error("The agreement signer must be an active crew member.")
  );
  await expect(createAgreement("crew", input, 1)).rejects.toThrow("active crew member");
});
