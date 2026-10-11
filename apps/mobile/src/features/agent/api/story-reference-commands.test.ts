import { beforeEach, expect, it, vi } from "vitest";
import { referenceCommands, type ReferenceCommand } from "./story-reference-commands";
vi.mock("@/lib/api-client", () => ({ api: {} }));
const h = vi.hoisted(() => ({
  generation: 1,
  create: vi.fn(),
  update: vi.fn(),
  addVersion: vi.fn(),
  review: vi.fn(),
  approve: vi.fn(),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("./story-references-api", async (original) => ({
  ...(await original<typeof import("./story-references-api")>()),
  storyReferences: () => h,
}));
const id = "11111111-1111-4111-8111-111111111111",
  slotId = "22222222-2222-4222-8222-222222222222";
const scope = { projectId: id, generation: 1 },
  permissions = { edit: true, review: true };
const create: ReferenceCommand = {
  action: "create",
  clientKey: id,
  slot: { key: "HERO", kind: "character", label: "Hero", description: "", required: true, rank: 0 },
};
const review: ReferenceCommand = {
  action: "review",
  clientKey: id,
  slotId,
  slotVersion: 3,
  versionId: id,
  input: {
    expectedReviewRevision: 2,
    decision: "approve",
    checklist: { technical: "pass", identityContinuity: "na", rights: "pass", safety: "pass" },
  },
};
let raw: string | null;
const storage = {
    read: () => raw,
    write: (v: string) => {
      raw = v;
    },
  },
  signal = () => new AbortController().signal;
const store = () => referenceCommands(scope, "user", storage);
beforeEach(() => {
  vi.resetAllMocks();
  raw = null;
  h.generation = 1;
  h.review.mockResolvedValue({ review: { id: slotId } });
});
it("persists exact create requests and retries them after reopening", async () => {
  h.create.mockRejectedValueOnce(Error("Lost response"));
  const client = store();
  await expect(client.submit(create, signal(), permissions)).rejects.toThrow("Lost response");
  expect(store().read()).toEqual(create);
  await store().submit(create, signal(), permissions);
  expect(store().read()).toBeNull();
  expect(h.create.mock.calls[0].slice(0, 2)).toEqual(h.create.mock.calls[1].slice(0, 2));
});
it("checkpoints approval so lost approval responses do not repeat the review", async () => {
  h.approve.mockRejectedValueOnce(Error("Lost approval"));
  await expect(store().submit(review, signal(), permissions)).rejects.toThrow("Lost approval");
  const pending = store().read()!;
  expect(pending).toMatchObject({ action: "approve", reviewId: slotId, slotVersion: 3 });
  await store().submit(pending, signal(), permissions);
  expect(h.review).toHaveBeenCalledTimes(1);
  expect(h.approve).toHaveBeenCalledTimes(2);
  expect(store().read()).toBeNull();
});
it("does not auto-approve rejected references", async () => {
  await store().submit(
    { ...review, input: { ...review.input, decision: "reject", comment: "Incorrect character" } },
    signal(),
    permissions
  );
  expect(h.approve).not.toHaveBeenCalled();
  expect(store().read()).toBeNull();
});
it("blocks different commands while the original result is uncertain", async () => {
  h.create.mockRejectedValue(Error("Timeout"));
  const client = store();
  await expect(client.submit(create, signal(), permissions)).rejects.toThrow();
  await expect(
    client.submit({ ...create, slot: { ...create.slot, label: "Other" } }, signal(), permissions)
  ).rejects.toThrow("pending");
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("enforces edit and review permissions before persisting or writing", async () => {
  await expect(store().submit(create, signal(), { edit: false, review: true })).rejects.toThrow(
    "permission"
  );
  await expect(store().submit(review, signal(), { edit: true, review: false })).rejects.toThrow(
    "permission"
  );
  expect(raw).toBeNull();
  expect(h.review).not.toHaveBeenCalled();
});
it("does not advance approval or clear recovery after cancellation", async () => {
  const c = new AbortController();
  h.review.mockImplementation(async () => {
    c.abort();
    return { review: { id: slotId } };
  });
  await expect(store().submit(review, c.signal, permissions)).rejects.toThrow();
  expect(store().read()).toEqual(review);
  expect(h.approve).not.toHaveBeenCalled();
});
it("does not accept a result into another account", async () => {
  h.create.mockImplementation(async () => {
    h.generation = 2;
  });
  await expect(store().submit(create, signal(), permissions)).rejects.toThrow("session expired");
  expect(raw).toContain("HERO");
});
it("rejects persisted commands from a different project", () => {
  raw = JSON.stringify({ projectId: slotId, command: create });
  expect(() => store().read()).toThrow();
});
