import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchCrewAgreements } from "./crew-agreements-api";
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
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

const page = {
  capabilities: { create: false },
  items: [record],
  nextCursor: null,
  total: 1,
  summary: { all: 1, active: 1, signed: 0, attention: 0 },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue(page);
});
it("requests filtered, paginated agreements without overriding server recipient scope", async () => {
  expect(
    await fetchCrewAgreements("crew", "active", "cursor", new AbortController().signal)
  ).toEqual(page);
  expect(api.get).toHaveBeenCalledExactlyOnceWith(
    "/crews/crew/agreements",
    expect.objectContaining({
      service: "aurora",
      params: { view: "active", limit: 50, cursor: "cursor" },
    })
  );
});
it.each(["signed", "attention"] as const)("rejects a sent agreement in %s view", async (view) => {
  await expect(
    fetchCrewAgreements("crew", view, null, new AbortController().signal)
  ).rejects.toThrow("scope");
});
it.each(["draft", "sending", "sent"] as const)("accepts %s under active", async (status) => {
  vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...record, status }] });
  expect(
    (await fetchCrewAgreements("crew", "active", null, new AbortController().signal)).items
  ).toHaveLength(1);
});
it.each(["declined", "expired", "failed", "voided"] as const)(
  "accepts %s under attention",
  async (status) => {
    vi.mocked(api.get).mockResolvedValue({ ...page, items: [{ ...record, status }] });
    expect(
      (await fetchCrewAgreements("crew", "attention", null, new AbortController().signal)).items
    ).toHaveLength(1);
  }
);
it.each([
  { items: [{ ...record, crewId: "other" }] },
  { items: [record, record] },
  { nextCursor: "cursor" },
])("rejects mixed scope/duplicate pagination %j", async (change) => {
  vi.mocked(api.get).mockResolvedValue({ ...page, ...change });
  await expect(
    fetchCrewAgreements("crew", "all", "cursor", new AbortController().signal)
  ).rejects.toThrow("scope or pagination");
});
it("preserves authoritative access errors", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("You cannot view agreements."));
  await expect(
    fetchCrewAgreements("crew", "all", null, new AbortController().signal)
  ).rejects.toThrow("You cannot view agreements.");
});
