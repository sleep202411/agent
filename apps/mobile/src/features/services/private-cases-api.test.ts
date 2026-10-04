import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchPrivateCases,
  fetchPrivateCase,
  writePrivateCase,
  caseOutbox,
} from "./private-cases-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
  stored: null as string | null,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({
    read: () => h.stored,
    write: (v: string) => {
      h.stored = v;
    },
  }),
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = {
  id: id(1),
  taskId: id(2),
  openedByUserId: "a",
  respondentUserId: "b",
  title: "Case",
  status: "open",
  ownerAdminId: null,
  version: 2,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
const history = {
  ...row,
  events: [
    {
      id: id(3),
      version: 2,
      actorId: "a",
      actorKind: "user",
      action: "message",
      message: "My evidence",
      submissionIds: [],
      attachmentIds: [],
      createdAt: row.createdAt,
    },
  ],
  nextBeforeVersion: null,
};
const command = {
  clientKey: id(4),
  expectedVersion: 2,
  attachmentIds: [],
  action: "message" as const,
  message: "Please review",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.stored = null;
  h.get.mockResolvedValue(history);
  h.post.mockResolvedValue({ ...row, version: 3 });
});
it("loads only participant cases and advances the official cursor", async () => {
  h.get.mockResolvedValue({ items: [row], nextBeforeId: null });
  await fetchPrivateCases("a", 1, id(8), signal());
  expect(h.get).toHaveBeenCalledWith(
    "/crew-disputes",
    expect.objectContaining({ retry: false, params: { limit: 20, beforeId: id(8) } })
  );
  await expect(fetchPrivateCases("outsider", 1, null, signal())).rejects.toThrow("participant");
});
it("rejects duplicates and nonadvancing list cursors", async () => {
  h.get.mockResolvedValue({ items: [row, row], nextBeforeId: null });
  await expect(fetchPrivateCases("a", 1, null, signal())).rejects.toThrow("pagination");
  h.get.mockResolvedValue({ items: [row], nextBeforeId: id(8) });
  await expect(fetchPrivateCases("a", 1, id(8), signal())).rejects.toThrow("pagination");
});
it("validates case identity, participation and descending history pages", async () => {
  await fetchPrivateCase(id(1), "b", 1, 3, signal());
  await expect(fetchPrivateCase(id(2), "a", 1, null, signal())).rejects.toThrow("identity");
  await expect(fetchPrivateCase(id(1), "other", 1, null, signal())).rejects.toThrow("participant");
  await expect(fetchPrivateCase(id(1), "a", 1, 2, signal())).rejects.toThrow("pagination");
  h.get.mockResolvedValue({ ...history, nextBeforeVersion: 7 });
  await expect(fetchPrivateCase(id(1), "a", 1, null, signal())).rejects.toThrow("pagination");
});
it("preserves the exact request key and version for server idempotency even after a later event", async () => {
  h.get.mockResolvedValue({ ...history, version: 5 });
  h.post.mockResolvedValue({ ...row, version: 5 });
  await writePrivateCase(id(1), "a", 1, command, signal());
  expect(h.post).toHaveBeenCalledWith(
    `/crew-disputes/${id(1)}/events`,
    expect.objectContaining({
      retry: false,
      data: {
        requestKey: id(4),
        expectedVersion: 2,
        action: "message",
        message: "Please review",
        submissionIds: [],
      },
    })
  );
});
it("refuses admin actions, invalid receipts and stale auth before writing", async () => {
  await expect(
    writePrivateCase(id(1), "a", 1, { ...command, action: "resolve" as never }, signal())
  ).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
  h.post.mockResolvedValue({ ...row, version: 2 });
  await expect(writePrivateCase(id(1), "a", 1, command, signal())).rejects.toThrow("receipt");
  h.generation = 2;
  await expect(writePrivateCase(id(1), "a", 1, command, signal())).rejects.toThrow("expired");
});
it("aborts after a permission response if the account changed", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return history;
  });
  await expect(writePrivateCase(id(1), "a", 1, command, signal())).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("retains the original durable command until the matching receipt", () => {
  const outbox = caseOutbox(id(1), "a", 1);
  outbox.save(command);
  expect(caseOutbox(id(1), "a", 1).read()).toEqual(command);
  expect(() => outbox.save({ ...command, message: "changed" })).toThrow();
  expect(() => outbox.clear(id(9))).toThrow();
  outbox.clear(command.clientKey);
  expect(outbox.read()).toBeNull();
});

it("retains an appeal action after the case is reopened by its first attempt", async () => {
  h.get.mockResolvedValue({ ...history, status: "appealed", version: 3 });
  h.post.mockResolvedValue({ ...row, status: "appealed", version: 3 });
  await writePrivateCase(id(1), "a", 1, { ...command, action: "appeal" }, signal());
  expect(h.post.mock.calls[0]![1].data).toMatchObject({
    action: "appeal",
    requestKey: command.clientKey,
    expectedVersion: 2,
  });
});

it("sends only explicitly selected attachments and keeps them in the durable retry", async () => {
  const input = { ...command, attachmentIds: [id(8)] };
  const box = caseOutbox(id(1), "a", 1);
  box.save(input);
  await writePrivateCase(id(1), "a", 1, box.read()!, signal());
  expect(h.post.mock.calls[0]![1].data.attachmentIds).toEqual([id(8)]);
  await expect(
    writePrivateCase(id(1), "a", 1, { ...input, attachmentIds: Array(21).fill(id(8)) }, signal())
  ).rejects.toThrow();
});

it("queries the official participant view on every page and rejects mismatched rows", async () => {
  h.get.mockResolvedValue({ items: [row], nextBeforeId: null });
  await fetchPrivateCases("a", 1, id(8), signal(), "initiated");
  expect(h.get).toHaveBeenLastCalledWith(
    "/crew-disputes",
    expect.objectContaining({ params: { limit: 20, view: "initiated", beforeId: id(8) } })
  );
  await fetchPrivateCases("b", 1, null, signal(), "responses");
  await expect(fetchPrivateCases("a", 1, null, signal(), "responses")).rejects.toThrow(
    "view mismatch"
  );
  await expect(fetchPrivateCases("b", 1, null, signal(), "initiated")).rejects.toThrow(
    "view mismatch"
  );
});
