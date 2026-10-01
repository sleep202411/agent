import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchCrewInvitationResponse,
  respondToCrewInvitation,
} from "./crew-invitation-response-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "shortCrew",
  inviteeUserId: "user",
  status: "pending" as const,
  expiresAt: "2099-01-01T00:00:00Z",
  crew: { id: "shortCrew", name: "Film crew", logo: null, tagline: null },
  agreementRequest: null,
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(row);
  h.post.mockResolvedValue({ accepted: true, crewId: row.crewId, memberId: "member" });
});
it("reads the authenticated recipient's exact invitation", async () => {
  expect(await fetchCrewInvitationResponse(row.id, "user", 1, signal())).toEqual(row);
});
it.each([
  { ...row, inviteeUserId: "someone" },
  { ...row, id: "22222222-2222-4222-8222-222222222222" },
  { ...row, crew: { ...row.crew, id: "other" } },
])("rejects foreign invitation identity", async (value) => {
  h.get.mockResolvedValue(value);
  await expect(fetchCrewInvitationResponse(row.id, "user", 1, signal())).rejects.toThrow(
    "identity"
  );
});
it("rechecks status before a single non-retrying accept", async () => {
  await respondToCrewInvitation(row, "user", 1, "accept", signal());
  expect(h.get).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0]).toEqual([
    `/crew-invitations/${row.id}/accept`,
    expect.objectContaining({ service: "aurora", retry: false }),
  ]);
});
it.each([
  { ...row, status: "revoked" },
  { ...row, expiresAt: "2000-01-01T00:00:00Z" },
  { ...row, crewId: "other", crew: { ...row.crew, id: "other" } },
])("does not write after status, expiry or Crew changes", async (value) => {
  h.get.mockResolvedValue(value);
  await expect(respondToCrewInvitation(row, "user", 1, "accept", signal())).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects a mismatched accepted receipt", async () => {
  h.post.mockResolvedValue({ accepted: true, crewId: "other", memberId: "member" });
  await expect(respondToCrewInvitation(row, "user", 1, "accept", signal())).rejects.toThrow(
    "receipt"
  );
});
it("validates decline acknowledgement", async () => {
  h.post.mockResolvedValue({ declined: true });
  await respondToCrewInvitation(row, "user", 1, "decline", signal());
  h.post.mockResolvedValue({ declined: false });
  await expect(respondToCrewInvitation(row, "user", 1, "decline", signal())).rejects.toThrow();
});
it("does not retry a lost mutation response", async () => {
  h.post.mockRejectedValue(new Error("Network lost"));
  await expect(respondToCrewInvitation(row, "user", 1, "accept", signal())).rejects.toThrow(
    "Network lost"
  );
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("rejects stale sessions before and after reads", async () => {
  h.generation = 2;
  await expect(fetchCrewInvitationResponse(row.id, "user", 1, signal())).rejects.toThrow("session");
  expect(h.get).not.toHaveBeenCalled();
  h.generation = 1;
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return row;
  });
  await expect(respondToCrewInvitation(row, "user", 1, "accept", signal())).rejects.toThrow(
    "session"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("does not start an aborted read", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchCrewInvitationResponse(row.id, "user", 1, c.signal)).rejects.toThrow("session");
  expect(h.get).not.toHaveBeenCalled();
});

it("preserves the assigned position and blocks acceptance when the reviewed grant changes", async () => {
  const invited = {
    ...row,
    positionCategory: "director" as const,
    policyKeys: ["finance" as const],
  };
  h.get.mockResolvedValue(invited);
  expect(await fetchCrewInvitationResponse(row.id, "user", 1, signal())).toEqual(invited);
  h.get.mockResolvedValue({ ...invited, positionCategory: "producer" });
  await expect(respondToCrewInvitation(invited, "user", 1, "accept", signal())).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
