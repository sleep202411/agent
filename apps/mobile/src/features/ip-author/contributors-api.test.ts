import { beforeEach, expect, it, vi } from "vitest";
import {
  contributorFields,
  contributorOutbox,
  contributorShare,
  fetchContributors,
  searchContributorUsers,
  submitContributor,
  type Contributor,
  type ContributorCommand,
} from "./contributors-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, post: h.post, patch: h.patch, delete: h.del },
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
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
const id = "11111111-1111-4111-8111-111111111111",
  memberId = "22222222-2222-4222-8222-222222222222",
  clientKey = "33333333-3333-4333-8333-333333333333";
const member: Contributor = {
  id: memberId,
  displayName: "Writer",
  userId: "123",
  role: "writer",
  customRole: null,
  revenueEligible: true,
  revenueShareBps: 3000,
  displayOrder: 0,
};
const snapshot = {
  ip: { id, title: "Story" },
  creatorShareBps: 4000,
  poolAllocatedBps: 3000,
  contributors: [member],
};
const create: ContributorCommand = {
  clientKey,
  action: "create",
  data: {
    displayName: "Artist",
    userId: "456",
    role: "artist",
    customRole: null,
    revenueEligible: true,
    revenueShareBps: 5000,
  },
};
const edit: ContributorCommand = {
  clientKey,
  action: "edit",
  before: member,
  data: { ...member, revenueShareBps: 9000 },
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.generation = 1;
  h.get.mockResolvedValue(snapshot);
  h.post.mockResolvedValue({ ...create.data, id: clientKey, displayOrder: 1 });
  h.patch.mockResolvedValue({ ...member, ...edit.data });
  h.del.mockResolvedValue({ removed: true });
});
it("loads only the requested IP and rejects duplicate identities or incorrect allocations", async () => {
  expect((await fetchContributors(id, 1, signal())).contributors).toEqual([member]);
  h.get.mockResolvedValue({ ...snapshot, ip: { id: memberId, title: "Wrong" } });
  await expect(fetchContributors(id, 1, signal())).rejects.toThrow("identity");
  h.get.mockResolvedValue({ ...snapshot, contributors: [member, member] });
  await expect(fetchContributors(id, 1, signal())).rejects.toThrow("Duplicate");
  h.get.mockResolvedValue({ ...snapshot, poolAllocatedBps: 0 });
  await expect(fetchContributors(id, 1, signal())).rejects.toThrow("allocation");
});
it("looks up exact contacts using the official endpoint and preserves Java string IDs", async () => {
  h.get.mockResolvedValue({
    users: [{ userId: "9007199254740999", nickname: "Writer", avatar: null }],
  });
  expect((await searchContributorUsers(" writer@example.com ", 1, signal()))[0].userId).toBe(
    "9007199254740999"
  );
  expect(h.get).toHaveBeenCalledWith(
    "/ip-commerce/users/search",
    expect.objectContaining({
      params: { q: "writer@example.com" },
      service: "aurora",
      retry: false,
    })
  );
  await expect(searchContributorUsers("ab", 1, signal())).rejects.toThrow();
});
it.each([
  ["", null],
  ["0", 0],
  ["33.33", 3333],
  ["100", 10000],
  ["100.01", undefined],
  ["1e2", undefined],
  ["-1", undefined],
  ["1.234", undefined],
  ["NaN", undefined],
])("parses shares %s without floating rounding", (text, expected) => {
  expect(contributorShare(text as string)).toBe(expected);
});
it("requires an account to earn but supports credits without an account", () => {
  expect(contributorFields.safeParse({ ...create.data, userId: null }).success).toBe(false);
  expect(
    contributorFields.safeParse({ ...create.data, userId: null, revenueEligible: false }).success
  ).toBe(true);
});
it("persists before POST and only clears an exact receipt", async () => {
  h.post.mockImplementation(async () => {
    expect(contributorOutbox(id, "owner", 1).read()).toEqual(create);
    return { ...create.data, id: clientKey, displayOrder: 1 };
  });
  await submitContributor(id, "owner", 1, create, signal());
  expect(h.post).toHaveBeenCalledWith(
    `/ip-commerce/me/ips/${id}/contributors`,
    expect.objectContaining({ data: create.data, retry: false })
  );
  expect(contributorOutbox(id, "owner", 1).read()).toBeNull();
});
it("does not replay a lost creation response, including after reopening the outbox", async () => {
  h.post.mockRejectedValue(new Error("Lost response"));
  await expect(submitContributor(id, "owner", 1, create, signal())).rejects.toThrow(
    "Lost response"
  );
  const pending = contributorOutbox(id, "owner", 1).read()!;
  await expect(submitContributor(id, "owner", 1, pending, signal())).rejects.toThrow("unresolved");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(contributorOutbox(id, "another-user", 1).read()).toBeNull();
  expect(contributorOutbox(memberId, "owner", 1).read()).toBeNull();
});
it("blocks concurrent identical submissions after both preflight reads", async () => {
  await Promise.allSettled([
    submitContributor(id, "owner", 1, create, signal()),
    submitContributor(id, "owner", 1, create, signal()),
  ]);
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("retains an ambiguous or mismatched receipt", async () => {
  h.post.mockResolvedValue({ ...member, ...create.data });
  await expect(submitContributor(id, "owner", 1, create, signal())).rejects.toThrow(
    "receipt mismatch"
  );
  expect(contributorOutbox(id, "owner", 1).read()).toEqual(create);
});
it("checks fresh allocation before writing and excludes the edited member from the total", async () => {
  await expect(
    submitContributor(
      id,
      "owner",
      1,
      { ...create, data: { ...create.data, revenueShareBps: 8000 } },
      signal()
    )
  ).rejects.toThrow("100%");
  expect(h.post).not.toHaveBeenCalled();
  await submitContributor(id, "owner", 1, edit, signal());
  expect(h.patch).toHaveBeenCalledWith(
    `/ip-commerce/me/ips/${id}/contributors/${memberId}`,
    expect.objectContaining({ data: contributorFields.parse(edit.data) })
  );
});
it("rejects known concurrent edits or missing targets without writing", async () => {
  h.get.mockResolvedValue({
    ...snapshot,
    contributors: [{ ...member, displayName: "Changed elsewhere" }],
  });
  await expect(submitContributor(id, "owner", 1, edit, signal())).rejects.toThrow("changed");
  expect(h.patch).not.toHaveBeenCalled();
  h.get.mockResolvedValue({ ...snapshot, contributors: [], poolAllocatedBps: 0 });
  await expect(
    submitContributor(id, "owner", 1, { clientKey, action: "remove", before: member }, signal())
  ).rejects.toThrow("changed");
  expect(h.del).not.toHaveBeenCalled();
});
it("removes the exact contributor and retains a lost removal receipt", async () => {
  await submitContributor(
    id,
    "owner",
    1,
    { clientKey, action: "remove", before: member },
    signal()
  );
  expect(h.del).toHaveBeenCalledWith(
    `/ip-commerce/me/ips/${id}/contributors/${memberId}`,
    expect.objectContaining({ retry: false })
  );
  h.del.mockRejectedValue(new Error("Lost removal reply"));
  await expect(
    submitContributor(id, "owner", 1, { clientKey, action: "remove", before: member }, signal())
  ).rejects.toThrow("Lost");
  expect(contributorOutbox(id, "owner", 1).read()?.action).toBe("remove");
});
it("stops on auth change or abort and cannot clear another pending command", async () => {
  const c = new AbortController();
  c.abort();
  await expect(submitContributor(id, "owner", 1, create, c.signal)).rejects.toThrow("expired");
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return snapshot;
  });
  await expect(submitContributor(id, "owner", 1, create, signal())).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
  h.generation = 1;
  const outbox = contributorOutbox(id, "owner", 1);
  outbox.save(create);
  expect(() => outbox.clear(memberId)).toThrow("pending");
  expect(outbox.read()).toEqual(create);
});
