import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  agreementActionChoices,
  runAgreementAction,
  type ActionAgreement,
} from "./agreement-actions-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const record: ActionAgreement = {
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
  canSync: true,
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

const failedSend: ActionAgreement = {
  ...record,
  providerDocumentId: null,
  status: "failed",
  delivery: { ...record.delivery, status: "failed", canRetry: true },
};
const failedArchive: ActionAgreement = {
  ...record,
  status: "signed",
  archive: { ...record.archive, status: "failed", canRetry: true },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("uses server retry capabilities and provider availability", () => {
  expect(agreementActionChoices(record)).toEqual(["sync"]);
  expect(agreementActionChoices({ ...record, canSync: false })).toEqual([]);
  expect(agreementActionChoices(failedSend)).toEqual(["send"]);
  expect(
    agreementActionChoices({ ...failedSend, delivery: { ...failedSend.delivery, canRetry: false } })
  ).toEqual([]);
  expect(agreementActionChoices(failedArchive)).toEqual(["sync", "archive"]);
  expect(
    agreementActionChoices({
      ...failedArchive,
      archive: { ...failedArchive.archive, canRetry: false },
    })
  ).toEqual(["sync"]);
});
it.each([
  { action: "sync" as const, row: record, path: "sync" },
  { action: "send" as const, row: failedSend, path: "send/retry" },
  { action: "archive" as const, row: failedArchive, path: "archive/retry" },
])("posts the existing $action contract", async ({ action, row, path }) => {
  vi.mocked(api.post).mockResolvedValue(row);
  await runAgreementAction(row, action, 1);
  expect(api.post).toHaveBeenCalledExactlyOnceWith(`/crew-agreements/${row.id}/${path}`, {
    service: "aurora",
  });
});
it.each(["send", "archive"] as const)("rejects unavailable %s locally", async (action) => {
  await expect(runAgreementAction(record, action, 1)).rejects.toThrow("not currently available");
  expect(api.post).not.toHaveBeenCalled();
});
it.each([
  { id: "22222222-2222-4222-8222-222222222222" },
  { crewId: "other" },
  { memberUserId: "other" },
  { signerName: "Other" },
  { signerEmail: "other@example.com" },
  { title: "Different Terms" },
  { providerDocumentId: "other-document" },
])("rejects mismatched action result %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({ ...record, ...change });
  await expect(runAgreementAction(record, "sync", 1)).rejects.toThrow("response mismatch");
});
it("accepts concurrent terminal state instead of assuming sync result", async () => {
  vi.mocked(api.post).mockResolvedValue({ ...record, status: "signed" });
  expect((await runAgreementAction(record, "sync", 1)).status).toBe("signed");
});
it("preserves server permission/provider failure", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Provider unavailable"));
  await expect(runAgreementAction(record, "sync", 1)).rejects.toThrow("Provider unavailable");
});
it("blocks stale requests and ignores late responses", async () => {
  h.generation = 2;
  await expect(runAgreementAction(record, "sync", 1)).rejects.toThrow("session expired");
  expect(api.post).not.toHaveBeenCalled();
  h.generation = 1;
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return record;
  });
  await expect(runAgreementAction(record, "sync", 1)).rejects.toThrow("session expired");
});
