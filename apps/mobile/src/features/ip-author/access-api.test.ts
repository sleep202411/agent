import { beforeEach, expect, it, vi } from "vitest";
import {
  accessMatches,
  accessOutbox,
  fetchIpAccess,
  submitIpAccess,
  type AccessCommand,
  type IpEditGrant,
} from "./access-api";
import { ApiRequestError } from "@/lib/api-client";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post, delete: h.del },
  ApiRequestError: class extends Error {
    constructor(
      _code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  grantId = "22222222-2222-4222-8222-222222222222",
  clientKey = "33333333-3333-4333-8333-333333333333";
const owner = {
  id,
  title: "Story",
  createdById: "123",
  version: 1,
  viewerAccess: { owner: true, canEdit: true, canManageAcl: true, canTransferOwner: true },
};
const editor = {
  ...owner,
  createdById: "456",
  version: 2,
  viewerAccess: { owner: false, canEdit: true, canManageAcl: false, canTransferOwner: false },
};
const grant: IpEditGrant = {
  id: grantId,
  ipId: id,
  userId: "456",
  permission: "edit",
  grantedById: "123",
  revokedById: null,
  revokedAt: null,
  createdAt: "2026-10-01T01:00:00Z",
  updatedAt: "2026-10-01T01:00:00Z",
};
const grantCommand: AccessCommand = { clientKey, action: "grant", toUserId: "789" };
const revoke: AccessCommand = { clientKey, action: "revoke", grantId, toUserId: "456" };
const transfer: AccessCommand = {
  clientKey,
  action: "transfer",
  toUserId: "456",
  removeOldOwner: false,
  expectedVersion: 1,
};
const signal = () => new AbortController().signal;
function readProfile(ip = owner, grants = [grant]) {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/acl") ? { ownerUserId: ip.createdById, grants } : { ip }
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  readProfile();
  h.post.mockResolvedValue({ grant: { ...grant, id: clientKey, userId: "789" } });
  h.del.mockResolvedValue({
    grant: { ...grant, revokedAt: "2026-10-01T02:00:00Z", revokedById: "123" },
    revoked: true,
  });
});
it("reads owner ACL but never requests it for editors", async () => {
  expect((await fetchIpAccess(id, "123", 1, signal())).grants).toEqual([grant]);
  h.get.mockClear();
  readProfile(editor);
  expect((await fetchIpAccess(id, "123", 1, signal())).grants).toEqual([]);
  expect(h.get).toHaveBeenCalledTimes(1);
});
it("rejects wrong profile, owner, grant IP, inactive grant, duplicate grant user and spoofed capabilities", async () => {
  readProfile({ ...owner, id: grantId });
  await expect(fetchIpAccess(id, "123", 1, signal())).rejects.toThrow("identity");
  readProfile({ ...owner, createdById: "456" });
  await expect(fetchIpAccess(id, "123", 1, signal())).rejects.toThrow("identity");
  readProfile(owner, [{ ...grant, ipId: grantId }]);
  await expect(fetchIpAccess(id, "123", 1, signal())).rejects.toThrow("identity");
  readProfile(owner, [{ ...grant, revokedAt: "2026-10-01T02:00:00Z" }]);
  await expect(fetchIpAccess(id, "123", 1, signal())).rejects.toThrow("identity");
  readProfile(owner, [grant, { ...grant, id: clientKey }]);
  await expect(fetchIpAccess(id, "123", 1, signal())).rejects.toThrow("identity");
  readProfile({ ...editor, viewerAccess: { ...editor.viewerAccess, canTransferOwner: true } });
  await expect(fetchIpAccess(id, "123", 1, signal())).rejects.toThrow("unavailable");
});
it("persists exact edit-grant intent before POST and checks its receipt", async () => {
  h.post.mockImplementation(async () => {
    expect(accessOutbox(id, "123", 1).read()).toEqual(grantCommand);
    return { grant: { ...grant, id: clientKey, userId: "789" } };
  });
  await submitIpAccess(id, "123", 1, grantCommand, signal());
  expect(h.post).toHaveBeenCalledWith(
    `/ip-commerce/me/ips/${id}/acl`,
    expect.objectContaining({ retry: false, data: { userId: "789", permission: "edit" } })
  );
  expect(accessOutbox(id, "123", 1).read()).toBeNull();
});
it("rejects owner grants and editor mutations; does not duplicate an active grant", async () => {
  await expect(
    submitIpAccess(id, "123", 1, { ...grantCommand, toUserId: "123" }, signal())
  ).rejects.toThrow("owner already");
  expect(
    (await submitIpAccess(id, "123", 1, { ...grantCommand, toUserId: "456" }, signal())).observed
  ).toBe(true);
  readProfile(editor);
  await expect(submitIpAccess(id, "123", 1, grantCommand, signal())).rejects.toThrow(
    "Only the IP owner"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("recovers a lost grant response by observing current access without repeating POST", async () => {
  h.post.mockImplementation(async () => {
    readProfile(owner, [grant, { ...grant, id: clientKey, userId: "789" }]);
    throw new Error("Lost reply");
  });
  await expect(submitIpAccess(id, "123", 1, grantCommand, signal())).rejects.toThrow("Lost");
  expect((await submitIpAccess(id, "123", 1, grantCommand, signal())).observed).toBe(true);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(accessOutbox(id, "123", 1).read()).toBeNull();
});
it("retries only the identical outstanding grant when the first request never arrived", async () => {
  h.post.mockRejectedValueOnce(new Error("Offline"));
  await expect(submitIpAccess(id, "123", 1, grantCommand, signal())).rejects.toThrow("Offline");
  await expect(
    submitIpAccess(id, "123", 1, { ...grantCommand, toUserId: "999" }, signal())
  ).rejects.toThrow("Another");
  await submitIpAccess(id, "123", 1, grantCommand, signal());
  expect(h.post).toHaveBeenCalledTimes(2);
});
it("uses the exact grant ID for revocation and verifies who revoked it", async () => {
  await submitIpAccess(id, "123", 1, revoke, signal());
  expect(h.del).toHaveBeenCalledWith(
    `/ip-commerce/me/ips/${id}/acl/${grantId}`,
    expect.objectContaining({ retry: false })
  );
  h.del.mockResolvedValue({
    grant: { ...grant, revokedAt: "2026-10-01T02:00:00Z", revokedById: "999" },
    revoked: true,
  });
  await expect(submitIpAccess(id, "123", 1, revoke, signal())).rejects.toThrow("receipt");
  expect(accessOutbox(id, "123", 1).read()).toEqual(revoke);
});
it("recovers a lost removal without deleting a newly granted permission for the same user", async () => {
  h.del.mockImplementation(async () => {
    readProfile(owner, [{ ...grant, id: clientKey }]);
    throw new Error("Lost reply");
  });
  await expect(submitIpAccess(id, "123", 1, revoke, signal())).rejects.toThrow("Lost");
  expect((await submitIpAccess(id, "123", 1, revoke, signal())).observed).toBe(true);
  expect(h.del).toHaveBeenCalledTimes(1);
  expect((await fetchIpAccess(id, "123", 1, signal())).grants[0].id).toBe(clientKey);
});
it("does not revoke a replaced grant from a stale confirmation", async () => {
  readProfile(owner, [{ ...grant, id: clientKey }]);
  await expect(submitIpAccess(id, "123", 1, revoke, signal())).rejects.toThrow("changed");
  expect(h.del).not.toHaveBeenCalled();
});
it("transfers to an existing editor with an explicit version fence and validates all receipt fields", async () => {
  h.post.mockResolvedValue({
    ipId: id,
    previousOwnerId: "123",
    newOwnerId: "456",
    oldOwnerKept: true,
  });
  await submitIpAccess(id, "123", 1, transfer, signal());
  expect(h.post).toHaveBeenCalledWith(
    `/ip-commerce/me/ips/${id}/transfer-owner`,
    expect.objectContaining({
      retry: false,
      data: { toUserId: "456", removeOldOwner: false, expectedVersion: 1 },
    })
  );
  h.post.mockResolvedValue({
    ipId: id,
    previousOwnerId: "123",
    newOwnerId: "456",
    oldOwnerKept: false,
  });
  await expect(submitIpAccess(id, "123", 1, transfer, signal())).rejects.toThrow("receipt");
  expect(accessOutbox(id, "123", 1).read()).toEqual(transfer);
});
it("blocks a new owner who is not an editor, stale IP versions and denied transfer capability", async () => {
  await expect(
    submitIpAccess(id, "123", 1, { ...transfer, toUserId: "789" }, signal())
  ).rejects.toThrow("already be an editor");
  readProfile({ ...owner, version: 2 });
  await expect(submitIpAccess(id, "123", 1, transfer, signal())).rejects.toThrow("changed");
  readProfile({ ...owner, viewerAccess: { ...owner.viewerAccess, canTransferOwner: false } });
  await expect(submitIpAccess(id, "123", 1, transfer, signal())).rejects.toThrow("unavailable");
  expect(h.post).not.toHaveBeenCalled();
});
it("recovers a lost transfer reply when the new owner and retained editor role are observable", async () => {
  h.post.mockImplementation(async () => {
    readProfile(editor);
    throw new Error("Lost transfer reply");
  });
  await expect(submitIpAccess(id, "123", 1, transfer, signal())).rejects.toThrow("Lost");
  expect((await submitIpAccess(id, "123", 1, transfer, signal())).observed).toBe(true);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(accessOutbox(id, "123", 1).read()).toBeNull();
});
it("never infers transfer success from a 404 after self-removal", async () => {
  const leave: AccessCommand = { ...transfer, removeOldOwner: true };
  h.post.mockImplementation(async () => {
    h.get.mockRejectedValue(new ApiRequestError("IP_NOT_FOUND", "IP not found", 404));
    throw new Error("Lost reply");
  });
  await expect(submitIpAccess(id, "123", 1, leave, signal())).rejects.toThrow("Lost");
  await expect(submitIpAccess(id, "123", 1, leave, signal())).rejects.toThrow("IP not found");
  expect(accessOutbox(id, "123", 1).read()).toEqual(leave);
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(accessMatches({ ip: editor, grants: [] }, leave)).toBe(false);
});
it("does not misidentify transfer to a different owner or unchanged version as a successful recovery", async () => {
  expect(accessMatches({ ip: { ...editor, createdById: "999" }, grants: [] }, transfer)).toBe(
    false
  );
  expect(accessMatches({ ip: { ...editor, version: 1 }, grants: [] }, transfer)).toBe(false);
});
it("requires the original version even if ownership returned to the previous owner", async () => {
  accessOutbox(id, "123", 1).save(transfer);
  readProfile({ ...owner, version: 3 });
  await expect(submitIpAccess(id, "123", 1, transfer, signal())).rejects.toThrow("changed");
  expect(h.post).not.toHaveBeenCalled();
  expect(accessOutbox(id, "123", 1).read()).toEqual(transfer);
});
it("aborts private reads and writes across auth changes, and isolates local pending records", async () => {
  const c = new AbortController();
  c.abort();
  await expect(fetchIpAccess(id, "123", 1, c.signal)).rejects.toThrow("expired");
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { ip: owner };
  });
  await expect(submitIpAccess(id, "123", 1, transfer, signal())).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
  h.generation = 1;
  accessOutbox(id, "123", 1).save(transfer);
  expect(accessOutbox(id, "456", 1).read()).toBeNull();
  expect(accessOutbox(grantId, "123", 1).read()).toBeNull();
  expect(() => accessOutbox(id, "123", 1).clear(grantId)).toThrow("pending");
});
it("does not allow a second command admitted during preflight to overwrite the first", async () => {
  const results = await Promise.allSettled([
    submitIpAccess(id, "123", 1, grantCommand, signal()),
    submitIpAccess(
      id,
      "123",
      1,
      { ...grantCommand, clientKey: grantId, toUserId: "888" },
      signal()
    ),
  ]);
  expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
  expect(h.post).toHaveBeenCalledTimes(1);
});
