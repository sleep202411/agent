import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  fetchLinkedAgreement,
  agreementMediaId,
  openAgreementSigning,
} from "./agreement-detail-api";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
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

const signal = () => new AbortController().signal;
const fetch = () => fetchLinkedAgreement("crew", record.id, "user", 1, signal());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("finds a linked agreement beyond the first page without narrowing server authorization", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({
      items: [{ ...record, id: "22222222-2222-4222-8222-222222222222" }],
      capabilities: { sync: true },
      nextCursor: "next",
    })
    .mockResolvedValueOnce({ items: [record], capabilities: { sync: true }, nextCursor: null });
  expect(await fetch()).toEqual({ ...record, canSync: true });
  expect(api.get).toHaveBeenLastCalledWith(
    "/crews/crew/agreements",
    expect.objectContaining({
      service: "aurora",
      params: { view: "all", limit: 100, cursor: "next" },
    })
  );
});
it("returns unavailable if the authorized list does not contain the reference", async () => {
  vi.mocked(api.get).mockResolvedValue({
    items: [],
    capabilities: { sync: true },
    nextCursor: null,
  });
  expect(await fetch()).toBeNull();
});
it.each([{ crewId: "other" }, { memberUserId: "other" }])(
  "rejects foreign scope %j",
  async (change) => {
    vi.mocked(api.get).mockResolvedValue({
      items: [{ ...record, ...change }],
      capabilities: { sync: true },
      nextCursor: null,
    });
    await expect(fetch()).rejects.toThrow();
  }
);
it("rejects cursor loops", async () => {
  vi.mocked(api.get).mockResolvedValue({
    items: [],
    capabilities: { sync: true },
    nextCursor: "next",
  });
  await expect(fetch()).rejects.toThrow("pagination repeated");
  expect(api.get).toHaveBeenCalledTimes(2);
});
it("rejects duplicate records across pages", async () => {
  const item = { ...record, id: "22222222-2222-4222-8222-222222222222" };
  vi.mocked(api.get).mockResolvedValue({
    items: [item],
    capabilities: { sync: true },
    nextCursor: "next",
  });
  await expect(fetch()).rejects.toThrow("pagination changed");
});
it("preserves access errors", async () => {
  vi.mocked(api.get).mockRejectedValue(new Error("You cannot view agreements."));
  await expect(fetch()).rejects.toThrow("You cannot view agreements.");
});
it("aborts before scanning the next page after account change", async () => {
  vi.mocked(api.get).mockImplementation(async () => {
    h.generation = 2;
    return { items: [], capabilities: { sync: true }, nextCursor: "next" };
  });
  await expect(fetch()).rejects.toThrow("session expired");
  expect(api.get).toHaveBeenCalledTimes(1);
});
it("does not request after cancellation", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchLinkedAgreement("crew", record.id, "user", 1, c.signal)).rejects.toThrow(
    "session expired"
  );
  expect(api.get).not.toHaveBeenCalled();
});
it("extracts only authenticated local media routes", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  expect(agreementMediaId(`/aurora/media/assets/${id}/content`)).toBe(id);
});
it.each([
  null,
  "https://evil.example/file",
  "javascript:alert(1)",
  "/aurora/media/assets/../../content",
  "/aurora/media/assets/22222222-2222-4222-8222-222222222222/content?token=x",
])("ignores unsafe archive link %s", (value) => {
  expect(agreementMediaId(value)).toBeNull();
});
it("requests a fresh signing link for the named signer only", async () => {
  vi.mocked(api.post).mockResolvedValue({
    signLink: "https://app.boldsign.com/sign/test",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  expect(await openAgreementSigning(record, "user", 1, signal())).toBe(
    "https://app.boldsign.com/sign/test"
  );
  expect(api.post).toHaveBeenCalledExactlyOnceWith(
    `/crew-agreements/${record.id}/signing-session`,
    expect.objectContaining({ service: "aurora" })
  );
});
it.each([
  { memberUserId: "other" },
  { status: "signed" as const },
  { capabilities: { sign: false } },
])("refuses unavailable signing %j", async (change) => {
  await expect(openAgreementSigning({ ...record, ...change }, "user", 1, signal())).rejects.toThrow(
    "not awaiting"
  );
  expect(api.post).not.toHaveBeenCalled();
});
it.each(["http://example.com", "https://user:password@example.com", "javascript:alert(1)"])(
  "rejects unsafe signing URL %s",
  async (signLink) => {
    vi.mocked(api.post).mockResolvedValue({
      signLink,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    await expect(openAgreementSigning(record, "user", 1, signal())).rejects.toThrow();
  }
);
it("rejects expired signing links", async () => {
  vi.mocked(api.post).mockResolvedValue({
    signLink: "https://app.boldsign.com/sign/test",
    expiresAt: new Date(Date.now() - 1).toISOString(),
  });
  await expect(openAgreementSigning(record, "user", 1, signal())).rejects.toThrow("expired");
});
it("does not accept signing response after account changes", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    h.generation = 2;
    return {
      signLink: "https://app.boldsign.com/sign/test",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    };
  });
  await expect(openAgreementSigning(record, "user", 1, signal())).rejects.toThrow(
    "session expired"
  );
});
