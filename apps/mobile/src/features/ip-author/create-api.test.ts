import { beforeEach, expect, it, vi } from "vitest";
import { createCommand, createIp, createOutbox } from "./create-api";
const h = vi.hoisted(() => ({ post: vi.fn(), generation: 1, records: new Map<string, string>() }));
vi.mock("@/lib/api-client", () => ({ api: { post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (n: string, u: string, id: string) => ({
    read: () => h.records.get(`${n}:${u}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${n}:${u}:${id}`, s),
  }),
}));
const command = {
  clientKey: "11111111-1111-4111-8111-111111111111",
  title: "Title",
  summary: "",
  genreCodes: ["drama"],
  sourceLocale: "en-US" as const,
  channelType: "community" as const,
  region: "sg",
};
const id = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.records.clear();
  h.post.mockResolvedValue({ ip: { id, createdById: "alice" } });
});
it("sends the official fields with a stable idempotency key and returns the created IP", async () => {
  expect(await createIp("alice", 1, command, new AbortController().signal)).toBe(id);
  expect(h.post.mock.calls[0][0]).toBe("/ip-commerce/ips");
  expect(h.post.mock.calls[0][1]).toMatchObject({
    service: "aurora",
    retry: false,
    data: {
      idempotencyKey: command.clientKey,
      title: "Title",
      summary: "",
      genreCodes: ["drama"],
      sourceLocale: "en-US",
      channelType: "community",
      region: "SG",
    },
  });
  expect(h.post.mock.calls[0][1].data).not.toHaveProperty("clientKey");
});
it("persists the exact command across remount, rejects rewrites and isolates owners", () => {
  const outbox = createOutbox("alice", 1);
  outbox.save(command);
  expect(createOutbox("alice", 1).read()).toEqual({ ...command, region: "SG" });
  expect(createOutbox("bob", 1).read()).toBeNull();
  expect(() => outbox.save({ ...command, title: "Other" })).toThrow("pending");
  expect(() => outbox.clear(id)).toThrow("pending");
  outbox.clear(command.clientKey);
  expect(outbox.read()).toBeNull();
});
it("omits an unspecified region and rejects invalid drafts before sending", async () => {
  await createIp("alice", 1, { ...command, region: "" }, new AbortController().signal);
  expect(h.post.mock.calls[0][1].data).not.toHaveProperty("region");
  for (const change of [
    { title: " " },
    { genreCodes: [] },
    { genreCodes: Array(9).fill("drama") },
    { summary: "x".repeat(281) },
    { channelType: "other" },
  ])
    expect(createCommand.safeParse({ ...command, ...change }).success).toBe(false);
});
it("rejects stale auth and mismatched or malformed receipts", async () => {
  h.generation = 2;
  await expect(createIp("alice", 1, command, new AbortController().signal)).rejects.toThrow(
    "expired"
  );
  expect(h.post).not.toHaveBeenCalled();
  h.generation = 1;
  h.post.mockResolvedValue({ ip: { id, createdById: "bob" } });
  await expect(createIp("alice", 1, command, new AbortController().signal)).rejects.toThrow(
    "owner mismatch"
  );
  h.post.mockResolvedValue({ ip: { id: "wrong", createdById: "alice" } });
  await expect(createIp("alice", 1, command, new AbortController().signal)).rejects.toThrow();
});
it("retains original payload on retry and discards a reply after cancellation", async () => {
  h.post.mockRejectedValueOnce(Error("Lost"));
  await expect(createIp("alice", 1, command, new AbortController().signal)).rejects.toThrow("Lost");
  await createIp("alice", 1, command, new AbortController().signal);
  expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
  const c = new AbortController();
  h.post.mockImplementation(async () => {
    c.abort();
    return { ip: { id, createdById: "alice" } };
  });
  await expect(createIp("alice", 1, command, c.signal)).rejects.toThrow();
});
