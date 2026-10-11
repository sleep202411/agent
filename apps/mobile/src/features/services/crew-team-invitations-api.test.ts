import { encodeUserId } from "@repo/shared/user-id-codec";
import { beforeEach, expect, it, vi } from "vitest";
import {
  createTeamInvitation,
  fetchTeamInvitations,
  lookupTeamInvitee,
  revokeTeamInvitation,
  teamInvitationPending,
} from "./crew-team-invitations-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
  permissions: ["members.invite", "members.manage", "members.permissions.manage"],
}));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string, user: string, crew: string) => ({
    read: () => h.records.get(`${namespace}:${user}:${crew}`) ?? null,
    write: (v: string) => h.records.set(`${namespace}:${user}:${crew}`, v),
  }),
}));
const input = {
  account: "artist@example.com",
  positionCategory: "director" as const,
  policyKeys: ["finance" as const],
  expiresInDays: 7,
  agreement: { title: "Film", signerName: "Artist", signerEmail: "artist@example.com" },
};
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  inviteeUserId: "artist",
  invitedByUserId: "actor",
  positionCategory: "director" as const,
  policyKeys: ["finance"],
  status: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
  createdAt: "2026-10-01T00:00:00Z",
  agreementRequest: { ...input.agreement, agreementId: null, status: null },
};
const signal = () => new AbortController().signal;
const create = () => createTeamInvitation("crew", "actor", 1, input, "artist", signal());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.permissions = ["members.invite", "members.manage", "members.permissions.manage"];
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions: h.permissions }
      : path === "/users/lookup" || path === "/users/by-id"
        ? { userId: "artist", nickname: "Artist", isCrewMember: false }
        : { items: [row], nextCursor: null, total: 1 }
  );
  h.post.mockResolvedValue(row);
  h.delete.mockResolvedValue({ revoked: true });
});
it("persists the exact intended role, grants and agreement before the single POST", async () => {
  h.post.mockImplementation(async () => {
    expect(teamInvitationPending("crew", "actor", 1).read()).toMatchObject({
      input,
      inviteeUserId: "artist",
    });
    return row;
  });
  expect(await create()).toEqual(row);
  expect(teamInvitationPending("crew", "actor", 1).read()).toBeNull();
  expect(h.post).toHaveBeenCalledWith(
    "/crews/crew/invitations",
    expect.objectContaining({ data: input, retry: false })
  );
});
it.each(
  [[], ["members.invite"], ["members.invite", "members.manage"]].map((permissions) => ({
    permissions,
  }))
)("rejects removed invite, position or policy permissions", async ({ permissions }) => {
  h.permissions = permissions;
  await expect(create()).rejects.toThrow(/permission/i);
  expect(h.post).not.toHaveBeenCalled();
});
it("supports ordinary invitations without privileged role or grants", async () => {
  h.permissions = ["members.invite"];
  h.post.mockResolvedValue({
    ...row,
    positionCategory: null,
    policyKeys: [],
    agreementRequest: null,
  });
  await createTeamInvitation(
    "crew",
    "actor",
    1,
    { account: input.account, policyKeys: [], expiresInDays: 1 },
    "artist",
    signal()
  );
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("does not send to a changed lookup recipient or existing member", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions: h.permissions }
      : { userId: "different", nickname: "Other", isCrewMember: false }
  );
  await expect(create()).rejects.toThrow("lookup changed");
  expect(h.post).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ userId: "actor", permissions: h.permissions });
  h.get
    .mockResolvedValueOnce({ userId: "actor", permissions: h.permissions })
    .mockResolvedValueOnce({ userId: "artist", nickname: "Artist", isCrewMember: true });
  await expect(lookupTeamInvitee("crew", "actor", 1, input.account, signal())).rejects.toThrow(
    "already"
  );
});
it("retains unknown writes across remounts and refuses another POST until explicit review", async () => {
  h.post.mockRejectedValue(new Error("lost"));
  await expect(create()).rejects.toThrow("lost");
  expect(teamInvitationPending("crew", "actor", 1).read()?.input).toEqual(input);
  await expect(create()).rejects.toThrow("Review the previous");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(teamInvitationPending("other", "actor", 1).read()).toBeNull();
  expect(teamInvitationPending("crew", "other", 1).read()).toBeNull();
  teamInvitationPending("crew", "actor", 1).clear();
  expect(teamInvitationPending("crew", "actor", 1).read()).toBeNull();
});
it.each([
  { crewId: "other" },
  { inviteeUserId: "other" },
  { invitedByUserId: "other" },
  { positionCategory: null },
  { policyKeys: [] },
  { agreementRequest: null },
])("does not clear an unverified receipt %j", async (change) => {
  h.post.mockResolvedValue({ ...row, ...change });
  await expect(create()).rejects.toThrow("receipt");
  expect(teamInvitationPending("crew", "actor", 1).read()).not.toBeNull();
});
it("rejects storage corruption without issuing a write", async () => {
  h.records.set("crew-team-invitation:actor:crew", "not json");
  await expect(create()).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("validates pagination scope and exposes independent permissions", async () => {
  expect(await fetchTeamInvitations("crew", "actor", 1, null, signal())).toMatchObject({
    items: [row],
    access: { positions: true, policies: true },
  });
  h.get
    .mockResolvedValueOnce({ userId: "actor", permissions: h.permissions })
    .mockResolvedValueOnce({ items: [{ ...row, crewId: "other" }], nextCursor: null, total: 1 });
  await expect(fetchTeamInvitations("crew", "actor", 1, null, signal())).rejects.toThrow("changed");
});
it("rejects stale sessions before network calls and after lookup", async () => {
  h.generation = 2;
  await expect(create()).rejects.toThrow("session");
  expect(h.get).not.toHaveBeenCalled();
  h.generation = 1;
  h.get.mockImplementation(async (path: string) => {
    if (path.endsWith("/me")) return { userId: "actor", permissions: h.permissions };
    h.generation = 2;
    return { userId: "artist", nickname: "Artist", isCrewMember: false };
  });
  await expect(create()).rejects.toThrow("session");
  expect(h.post).not.toHaveBeenCalled();
});
it("rechecks permission and verifies explicit revocation", async () => {
  await revokeTeamInvitation(
    "crew",
    "actor",
    1,
    { ...row, status: "pending", policyKeys: ["finance"] },
    signal()
  );
  expect(h.delete).toHaveBeenCalledWith(
    `/crew-invitations/${row.id}`,
    expect.objectContaining({ retry: false })
  );
  h.delete.mockResolvedValue({ revoked: false });
  await expect(
    revokeTeamInvitation(
      "crew",
      "actor",
      1,
      { ...row, status: "pending", policyKeys: ["finance"] },
      signal()
    )
  ).rejects.toThrow();
});

it("uses explicit ID lookup and preserves that mode in durable send recovery", async () => {
  const data = { ...input, account: "42", lookupBy: "userId" as const };
  h.post.mockRejectedValueOnce(new Error("Response lost"));
  await expect(createTeamInvitation("crew", "actor", 1, data, "artist", signal())).rejects.toThrow(
    "Response lost"
  );
  expect(h.get).toHaveBeenCalledWith(
    "/users/by-id",
    expect.objectContaining({ params: { id: "42", idFormat: "public", checkCrewId: "crew" } })
  );
  expect(teamInvitationPending("crew", "actor", 1).read()?.input).toEqual(data);
});
it.each(["artist@example.com", "+6512345678", "1234567890123456789"])(
  "rejects invalid ID-mode input %s before lookup",
  async (account) => {
    await expect(
      lookupTeamInvitee("crew", "actor", 1, account, signal(), "userId")
    ).rejects.toThrow();
    expect(h.get).not.toHaveBeenCalled();
  }
);

it.each(["42", "12345678", "123456789012345678"])(
  "looks up the displayed ID for %s and sends the same public input",
  async (rawId) => {
    const publicId = encodeUserId(rawId);
    h.get.mockImplementation(async (path: string) =>
      path.endsWith("/me")
        ? { userId: "actor", permissions: h.permissions }
        : { userId: rawId, nickname: "Artist", isCrewMember: false }
    );
    h.post.mockResolvedValue({ ...row, inviteeUserId: rawId });
    const data = { ...input, account: ` ${publicId} `, lookupBy: "userId" as const };
    const target = await lookupTeamInvitee("crew", "actor", 1, data.account, signal(), "userId");
    await createTeamInvitation("crew", "actor", 1, data, target.userId, signal());
    expect(h.get).toHaveBeenCalledWith(
      "/users/by-id",
      expect.objectContaining({ params: { id: publicId, idFormat: "public", checkCrewId: "crew" } })
    );
    expect(h.post).toHaveBeenCalledWith(
      "/crews/crew/invitations",
      expect.objectContaining({ data: { ...data, account: publicId }, retry: false })
    );
    expect(teamInvitationPending("crew", "actor", 1).read()).toBeNull();
  }
);
it("rejects a damaged public ID checksum before any request", async () => {
  const valid = encodeUserId("123456789012345678");
  const damaged = valid.slice(0, -1) + (valid.endsWith("0") ? "1" : "0");
  await expect(lookupTeamInvitee("crew", "actor", 1, damaged, signal(), "userId")).rejects.toThrow(
    "Invalid invitation recipient"
  );
  expect(h.get).not.toHaveBeenCalled();
});
