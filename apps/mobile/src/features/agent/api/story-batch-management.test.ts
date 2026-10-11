import { beforeEach, expect, it, vi } from "vitest";
import { storyBatchManagement } from "./story-batch-management";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (...keys: string[]) => ({
    read: () => h.records.get(keys.join(":")) ?? null,
    write: (value: string) => h.records.set(keys.join(":"), value),
  }),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), chapterId: id(2), generation: 1 };
const row = {
  id: id(3),
  ...scope,
  version: 1,
  status: "awaiting_confirmation",
  totalPoints: 20,
  itemCount: 1,
  canCancel: true,
  availablePoints: "50",
  quoteExpiresAt: "2026-10-11T00:00:00Z",
  items: [
    {
      id: id(4),
      targetId: id(5),
      targetVersion: 2,
      targetKind: "asset_spec",
      status: "awaiting_confirmation",
      modelId: "model",
      quotedPoints: 20,
    },
  ],
};
const command = { clientKey: id(6), targets: [{ id: id(5), expectedVersion: 2 }] };
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.get.mockResolvedValue([row]);
  h.post.mockResolvedValue(row);
});
it("reads manually created and blocked batches without mutating", async () => {
  h.get.mockResolvedValue([{ ...row, status: "blocked" }]);
  expect((await storyBatchManagement(scope, "user").list(signal()))[0].status).toBe("blocked");
  expect(h.post).not.toHaveBeenCalled();
});
it("retains the exact quote across lost responses and retries without duplicating the request key", async () => {
  const client = storyBatchManagement(scope, "user");
  h.post.mockRejectedValueOnce(Error("Connection lost"));
  await expect(client.quote(command, signal())).rejects.toThrow("Connection lost");
  expect(client.pending()).toEqual(command);
  await expect(client.quote({ ...command, clientKey: id(7) }, signal())).rejects.toThrow("pending");
  await storyBatchManagement(scope, "user").quote(command, signal());
  expect(h.post).toHaveBeenCalledTimes(2);
  expect(h.post.mock.calls[0][1].headers).toEqual(h.post.mock.calls[1][1].headers);
  expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
  expect(client.pending()).toBeNull();
});
it("never confirms a quoted cost automatically", async () => {
  const client = storyBatchManagement(scope, "user");
  const quote = await client.quote(command, signal());
  expect(h.post).toHaveBeenCalledTimes(1);
  await client.act("confirm", quote, signal());
  expect(h.post).toHaveBeenLastCalledWith(
    expect.stringContaining(`/${row.id}/confirm`),
    expect.objectContaining({ retry: false, data: { expectedVersion: 1 } })
  );
});
it.each([{ projectId: id(9) }, { chapterId: id(9) }, { itemCount: 2 }])(
  "rejects inconsistent batch receipts: %j",
  async (change) => {
    h.get.mockResolvedValue([{ ...row, ...change }]);
    await expect(storyBatchManagement(scope, "user").list(signal())).rejects.toThrow();
  }
);
it("retains mismatched target quotes for recovery", async () => {
  h.post.mockResolvedValue({ ...row, items: [{ ...row.items[0], targetVersion: 9 }] });
  const client = storyBatchManagement(scope, "user");
  await expect(client.quote(command, signal())).rejects.toThrow("selected assets");
  expect(client.pending()).toEqual(command);
});
it("rejects late account-switch results and never starts writes from an expired session", async () => {
  const client = storyBatchManagement(scope, "user");
  h.get.mockImplementation(async () => {
    h.generation++;
    return [row];
  });
  await expect(client.list(signal())).rejects.toThrow("expired");
  await expect(client.quote(command, signal())).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("isolates persisted quotes by account and chapter", async () => {
  h.post.mockRejectedValue(Error("offline"));
  await expect(storyBatchManagement(scope, "user").quote(command, signal())).rejects.toThrow();
  expect(storyBatchManagement(scope, "other").pending()).toBeNull();
  expect(storyBatchManagement({ ...scope, chapterId: id(8) }, "user").pending()).toBeNull();
});

it("quotes saved storyboard versions through the storyboard endpoint", async () => {
  const client = storyBatchManagement(scope, "user", "storyboard");
  h.post.mockResolvedValue({
    ...row,
    items: [{ ...row.items[0], targetKind: "storyboard_clip", sequenceId: id(8) }],
  });
  await client.quote(
    { ...command, targets: [{ ...command.targets[0], sequenceId: id(8) }] },
    signal()
  );
  expect(h.post).toHaveBeenCalledWith(
    expect.stringContaining("/storyboard/clips/quote"),
    expect.objectContaining({
      data: { targets: [{ id: id(5), expectedVersion: 2, sequenceId: id(8) }] },
    })
  );
});
it("rejects mixed batch types before creating an unresolved request", async () => {
  const client = storyBatchManagement(scope, "user", "storyboard");
  await expect(client.quote(command, signal())).rejects.toThrow("batch type");
  expect(client.pending()).toBeNull();
  expect(h.post).not.toHaveBeenCalled();
});
it("retains a wrong-sequence quote instead of accepting it", async () => {
  const client = storyBatchManagement(scope, "user", "storyboard");
  h.post.mockResolvedValue({
    ...row,
    items: [{ ...row.items[0], targetKind: "storyboard_clip", sequenceId: id(9) }],
  });
  await expect(
    client.quote({ ...command, targets: [{ ...command.targets[0], sequenceId: id(8) }] }, signal())
  ).rejects.toThrow("selected assets");
  expect(client.pending()).not.toBeNull();
});

it("lets the user discard an obsolete quote intent without dispatching or cancelling generation", async () => {
  const client = storyBatchManagement(scope, "user");
  h.post.mockRejectedValueOnce(Error("Asset version changed"));
  await expect(client.quote(command, signal())).rejects.toThrow("version changed");
  client.discardQuote();
  expect(client.pending()).toBeNull();
  expect(h.post).toHaveBeenCalledTimes(1);
  await client.quote({ ...command, clientKey: id(8) }, signal());
  expect(h.post).toHaveBeenCalledTimes(2);
});
