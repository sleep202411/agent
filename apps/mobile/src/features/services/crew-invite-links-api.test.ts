import { beforeEach, expect, it, vi } from "vitest";
import {
  createCrewLink,
  crewLinkPending,
  crewLinkUrl,
  fetchCrewLinks,
  revokeCrewLink,
} from "./crew-invite-links-api";
const h = vi.hoisted(() => ({
  generation: 1,
  detail: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  records: new Map<string, string>(),
  permissions: ["members.invite", "members.permissions.manage"],
}));
vi.mock("./task-detail-api", () => ({ fetchTaskDetail: h.detail }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (n: string, u: string, c: string) => ({
    read: () => h.records.get(n + u + c) ?? null,
    write: (s: string) => h.records.set(n + u + c, s),
  }),
}));
const input = {
  kind: "member" as const,
  policyKeys: ["finance" as const],
  expiresInDays: 7,
  maxUses: 5,
};
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  kind: "member" as const,
  policyKeys: ["finance" as const],
  maxUses: 5,
  useCount: 0,
  expiresAt: "2026-10-09T00:00:00Z",
  createdAt: "2026-10-02T00:00:00Z",
  createdByUserId: "actor",
  state: "active" as const,
};
const signal = () => new AbortController().signal;
const pending = () => crewLinkPending("crew", "actor", 1);
const create = () => createCrewLink("crew", "actor", 1, input, signal());
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.permissions = ["members.invite", "members.permissions.manage"];
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me") ? { userId: "actor", permissions: h.permissions } : [row]
  );
  h.post.mockResolvedValue({ ...row, token: "a".repeat(32) });
  h.delete.mockResolvedValue(undefined);
});
it("records exact creation intent before one POST and never stores the bearer token", async () => {
  h.post.mockImplementation(async () => {
    expect(pending().read()).toMatchObject({ kind: "create", input });
    return { ...row, token: "a".repeat(32) };
  });
  expect((await create()).token).toBe("a".repeat(32));
  expect(pending().read()).toBeNull();
  expect([...h.records.values()].join()).not.toContain("a".repeat(32));
  expect(h.post).toHaveBeenCalledTimes(1);
});
it.each([[], ["members.invite"]].map((permissions) => ({ permissions })))(
  "enforces fresh privilege checks: %j",
  async ({ permissions }) => {
    h.permissions = permissions;
    await expect(create()).rejects.toThrow(/permission/i);
    expect(h.post).not.toHaveBeenCalled();
  }
);
it("rejects community permission grants before network access", async () => {
  await expect(
    createCrewLink("crew", "actor", 1, { ...input, kind: "community" }, signal())
  ).rejects.toThrow("Community");
  expect(h.get).not.toHaveBeenCalled();
});
it("supports ordinary community links with no expiry or cap", async () => {
  h.permissions = ["members.invite"];
  h.post.mockResolvedValue({
    ...row,
    kind: "community",
    policyKeys: [],
    maxUses: null,
    expiresAt: null,
    token: "b".repeat(32),
  });
  expect(
    (await createCrewLink("crew", "actor", 1, { kind: "community", policyKeys: [] }, signal())).kind
  ).toBe("community");
});
it("retains an uncertain creation across reload and blocks repeat commands", async () => {
  h.post.mockRejectedValue(new Error("Lost response"));
  await expect(create()).rejects.toThrow("Lost response");
  expect(pending().read()?.kind).toBe("create");
  await expect(create()).rejects.toThrow("previous");
  await expect(revokeCrewLink("crew", "actor", 1, row, signal())).rejects.toThrow("previous");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.delete).not.toHaveBeenCalled();
});
it.each([
  { crewId: "other" },
  { createdByUserId: "other" },
  { policyKeys: [] },
  { maxUses: 10 },
  { expiresAt: null },
  { kind: "community" },
  { token: "bad" },
  { useCount: 1 },
])("retains mismatched receipts: %j", async (change) => {
  h.post.mockResolvedValue({ ...row, token: "a".repeat(32), ...change });
  await expect(create()).rejects.toThrow();
  expect(pending().read()?.kind).toBe("create");
});
it("lists only verified Crew rows without treating absence as a mutation receipt", async () => {
  pending().save({ kind: "create", input, startedAt: new Date().toISOString() });
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me") ? { userId: "actor", permissions: h.permissions } : []
  );
  expect((await fetchCrewLinks("crew", "actor", 1, signal())).links).toEqual([]);
  expect(pending().read()).not.toBeNull();
});
it.each([
  [{ ...row, crewId: "other" }],
  [row, row],
  [{ ...row, state: "revoked" }],
  [{ ...row, kind: "community" }],
])("rejects inconsistent lists", async (...args) => {
  const rows = args;
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me") ? { userId: "actor", permissions: h.permissions } : rows
  );
  await expect(fetchCrewLinks("crew", "actor", 1, signal())).rejects.toThrow();
});
it("records the exact revoke before DELETE and clears only after success", async () => {
  h.delete.mockImplementation(async () => {
    expect(pending().read()).toMatchObject({ kind: "revoke", link: row });
  });
  await revokeCrewLink("crew", "actor", 1, row, signal());
  expect(pending().read()).toBeNull();
  expect(h.delete).toHaveBeenCalledWith(
    `/crews/crew/invite-links/${row.id}`,
    expect.objectContaining({ retry: false })
  );
});
it("keeps a missing/revoked error uncertain and requires explicit local clearance", async () => {
  h.delete.mockRejectedValue(new Error("not found or already revoked"));
  await expect(revokeCrewLink("crew", "actor", 1, row, signal())).rejects.toThrow();
  expect(pending().read()?.kind).toBe("revoke");
  pending().clear();
  expect(pending().read()).toBeNull();
  expect(h.delete).toHaveBeenCalledTimes(1);
});
it("isolates accounts and Crew records and rejects corrupt state", () => {
  pending().save({ kind: "create", input, startedAt: new Date().toISOString() });
  expect(crewLinkPending("other", "actor", 1).read()).toBeNull();
  expect(crewLinkPending("crew", "other", 1).read()).toBeNull();
  h.records.set("crew-invite-linkactorcrew", "broken");
  expect(() => pending().read()).toThrow();
});
it("stops a mutation when preflight changes account or is cancelled", async () => {
  h.get.mockImplementation(async () => {
    h.generation++;
    return { userId: "actor", permissions: h.permissions };
  });
  await expect(create()).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("uses only the selected regional origin", () => {
  expect(crewLinkUrl("a".repeat(32), "cn")).toBe(
    `https://fizzdragon.fizzspace.cn/crew-invite/${"a".repeat(32)}`
  );
  expect(crewLinkUrl("a".repeat(32), "global")).toContain("https://fizzdragon.com/");
  expect(() => crewLinkUrl("bad", "global")).toThrow();
});

const taskId = "00000000-0000-4000-8000-000000000001";
const taskInput = { kind: "member" as const, policyKeys: [], maxUses: 1, taskId, taskVersion: 3 };
const taskLink = { ...row, taskId, taskVersion: 3, policyKeys: [], maxUses: 1, expiresAt: null };
it("binds one-use links to freshly authorized, unchanged, unassigned tasks", async () => {
  h.permissions = ["members.invite", "tasks.manage"];
  h.detail.mockResolvedValue({ version: 3, isRecruiting: false, assignees: [], status: "open" });
  h.post.mockImplementation(async () => {
    expect(crewLinkPending("crew", "actor", 1, taskId).read()).toMatchObject({ input: taskInput });
    expect(pending().read()).toBeNull();
    return { ...taskLink, token: "a".repeat(32) };
  });
  await createCrewLink("crew", "actor", 1, taskInput, signal());
  expect(h.post.mock.calls[0][1].data).toEqual(taskInput);
  expect(crewLinkPending("crew", "actor", 1, taskId).read()).toBeNull();
});
it.each([
  { version: 4 },
  { isRecruiting: true },
  { assignees: [{ userId: "assigned" }] },
  { status: "submitted" },
])("does not create after task eligibility changes %j", async (change) => {
  h.permissions = ["members.invite", "tasks.manage"];
  h.detail.mockResolvedValue({
    version: 3,
    isRecruiting: false,
    assignees: [],
    status: "open",
    ...change,
  });
  await expect(createCrewLink("crew", "actor", 1, taskInput, signal())).rejects.toThrow(
    "unavailable"
  );
  expect(h.post).not.toHaveBeenCalled();
});
it("separates task links from general Crew links and rejects unsafe grants", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions: h.permissions }
      : [row, { ...taskLink, id: "00000000-0000-4000-8000-000000000002" }]
  );
  expect((await fetchCrewLinks("crew", "actor", 1, signal())).links).toEqual([row]);
  expect((await fetchCrewLinks("crew", "actor", 1, signal(), taskId)).links).toHaveLength(1);
  for (const change of [
    { maxUses: 2 },
    { policyKeys: ["admin"] },
    { kind: "community" },
    { taskVersion: undefined },
  ])
    await expect(
      createCrewLink("crew", "actor", 1, { ...taskInput, ...change } as typeof taskInput, signal())
    ).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});

it("requests task-scoped pages and follows the returned cursor", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions: h.permissions }
      : { items: [taskLink], nextCursor: taskLink.id }
  );
  const first = await fetchCrewLinks("crew", "actor", 1, signal(), taskId);
  expect(first.links).toEqual([taskLink]);
  expect(first.nextCursor).toBe(taskLink.id);
  expect(h.get).toHaveBeenLastCalledWith(
    `/crews/crew/invite-links?paginated=true&limit=50&taskId=${taskId}`,
    expect.objectContaining({ retry: false })
  );
});
