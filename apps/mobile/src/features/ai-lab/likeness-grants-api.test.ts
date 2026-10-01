import { beforeEach, expect, it, vi } from "vitest";
import {
  loadLikenesses,
  loadLikenessGrants,
  likenessWithdrawalBox,
  prepareLikenessWithdrawal,
  withdrawLikenessGrant,
  reconcileLikenessWithdrawal,
  type Likeness,
  type LikenessGrant,
} from "./likeness-grants-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  remove: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, delete: h.remove } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(ns + user + id) ?? null,
    write: (v: string) => h.records.set(ns + user + id, v),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333";
const character: Likeness = {
  id,
  workspaceId: id,
  name: "My likeness",
  kind: "real_person",
  status: "active",
};
const grant: LikenessGrant = {
  id: other,
  projectId: key,
  projectName: "Film",
  status: "active",
  createdAt: "2026-01-01T00:00:00Z",
  revokedAt: null,
};
const intent = () => prepareLikenessWithdrawal(character, grant, key),
  signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.get.mockResolvedValue({ items: [grant] });
  h.remove.mockResolvedValue({ ok: true });
});
it("lists real-person likenesses across statuses without hiding withdrawal access", async () => {
  h.get.mockResolvedValue({
    items: [
      character,
      { ...character, id: other, status: "revoked" },
      { ...character, id: key, kind: "virtual" },
    ],
  });
  expect((await loadLikenesses(id, 1, signal())).map((r) => r.id)).toEqual([id, other]);
});
it("rejects workspace mismatch, duplicate grants and conflicting active project grants", async () => {
  h.get.mockResolvedValue({ items: [{ ...character, workspaceId: other }] });
  await expect(loadLikenesses(id, 1, signal())).rejects.toThrow("workspace");
  for (const second of [grant, { ...grant, id: key }]) {
    h.get.mockResolvedValue({ items: [grant, second] });
    await expect(loadLikenessGrants(id, 1, signal())).rejects.toThrow("Conflicting");
  }
});
it("checks subject permission and the exact grant before writing", async () => {
  h.get.mockRejectedValueOnce(new Error("Subject mismatch"));
  await expect(withdrawLikenessGrant(intent(), "actor", 1, signal())).rejects.toThrow(
    "Subject mismatch"
  );
  expect(h.remove).not.toHaveBeenCalled();
  for (const patch of [
    { id: key },
    { projectName: "Changed" },
    { createdAt: "2026-02-01T00:00:00Z" },
    { status: "revoked" },
  ]) {
    h.get.mockResolvedValueOnce({ items: [{ ...grant, ...patch }] });
    await expect(withdrawLikenessGrant(intent(), "actor", 1, signal())).rejects.toThrow("changed");
  }
  expect(h.remove).not.toHaveBeenCalled();
  expect(likenessWithdrawalBox("actor", 1, id).read()).toBeNull();
});
it("persists before DELETE, disables retries and clears only a validated receipt", async () => {
  h.remove.mockImplementation(async (path, options) => {
    expect(path).toBe(`/characters/${id}/grants/${key}`);
    expect(options.retry).toBe(false);
    expect(likenessWithdrawalBox("actor", 1, id).read()).toEqual(intent());
    return { ok: true };
  });
  await withdrawLikenessGrant(intent(), "actor", 1, signal());
  expect(likenessWithdrawalBox("actor", 1, id).read()).toBeNull();
});
it("keeps uncertain withdrawals after restart and never replays against a new grant", async () => {
  h.remove.mockRejectedValue(new Error("Response lost"));
  await expect(withdrawLikenessGrant(intent(), "actor", 1, signal())).rejects.toThrow("lost");
  expect(likenessWithdrawalBox("actor", 1, id).read()).toEqual(intent());
  expect(likenessWithdrawalBox("other-user", 1, id).read()).toBeNull();
  h.get.mockResolvedValue({ items: [{ ...grant, id: key }] });
  await expect(withdrawLikenessGrant(intent(), "actor", 1, signal())).rejects.toThrow("previous");
  expect(h.remove).toHaveBeenCalledTimes(1);
  expect(await reconcileLikenessWithdrawal("actor", 1, id, signal())).toBe(false);
  expect(likenessWithdrawalBox("actor", 1, id).read()).not.toBeNull();
});
it("reconciles only the original revoked record, leaving a replacement untouched", async () => {
  likenessWithdrawalBox("actor", 1, id).save(intent());
  for (const rows of [
    [],
    [grant],
    [{ ...grant, status: "revoked", revokedAt: null }],
    [
      {
        ...grant,
        status: "revoked",
        revokedAt: "2026-02-01T00:00:00Z",
        createdAt: "2025-01-01T00:00:00Z",
      },
    ],
  ]) {
    h.get.mockResolvedValueOnce({ items: rows });
    expect(await reconcileLikenessWithdrawal("actor", 1, id, signal())).toBe(false);
  }
  h.get.mockResolvedValue({
    items: [
      { ...grant, status: "revoked", revokedAt: "2026-02-01T00:00:00Z" },
      { ...grant, id: key, createdAt: "2026-03-01T00:00:00Z" },
    ],
  });
  expect(await reconcileLikenessWithdrawal("actor", 1, id, signal())).toBe(true);
  expect(likenessWithdrawalBox("actor", 1, id).read()).toBeNull();
  expect(h.remove).not.toHaveBeenCalled();
});
it("does not accept malformed or late receipts after account changes", async () => {
  h.remove.mockResolvedValueOnce({ ok: false });
  await expect(withdrawLikenessGrant(intent(), "actor", 1, signal())).rejects.toThrow();
  expect(likenessWithdrawalBox("actor", 1, id).read()).not.toBeNull();
  h.records.clear();
  h.remove.mockImplementation(async () => {
    h.generation = 2;
    return { ok: true };
  });
  await expect(withdrawLikenessGrant(intent(), "actor", 1, signal())).rejects.toThrow();
  h.generation = 1;
  expect(likenessWithdrawalBox("actor", 1, id).read()).not.toBeNull();
});
it("rejects cancelled reads without calling the server", async () => {
  const c = new AbortController();
  c.abort();
  await expect(loadLikenessGrants(id, 1, c.signal)).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
});
