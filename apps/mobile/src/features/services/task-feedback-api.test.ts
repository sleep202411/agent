import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchTaskFeedback,
  writeTaskFeedback,
  feedbackOutbox,
  type TaskFeedback,
} from "./task-feedback-api";
const h = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, put: h.put, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const row: TaskFeedback = {
  id: id(1),
  taskId: id(2),
  submissionId: id(3),
  authorUserId: "author",
  subjectUserId: "subject",
  ratings: { direction: "manager", managementAbility: 4 },
  comment: "Useful review",
  response: null,
  createdAt: "2026-10-01T00:00:00Z",
  respondedAt: null,
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
});
it("loads only personal feedback and uses the server cursor", async () => {
  await fetchTaskFeedback("subject", 1, id(4), signal());
  expect(h.get).toHaveBeenCalledWith(
    "/me/crew-task-feedback",
    expect.objectContaining({ params: { limit: 20, cursor: id(4) }, retry: false })
  );
  h.get.mockResolvedValue({ items: [row], nextCursor: null });
  await expect(fetchTaskFeedback("other", 1, null, signal())).rejects.toThrow("account mismatch");
});
it("rejects duplicate entries and nonadvancing cursors", async () => {
  h.get.mockResolvedValue({ items: [row, row], nextCursor: null });
  await expect(fetchTaskFeedback("subject", 1, null, signal())).rejects.toThrow("pagination");
  h.get.mockResolvedValue({ items: [row], nextCursor: id(4) });
  await expect(fetchTaskFeedback("subject", 1, id(4), signal())).rejects.toThrow("pagination");
});
it("abandons stale account and cancelled reads", async () => {
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { items: [row], nextCursor: null };
  });
  await expect(fetchTaskFeedback("subject", 1, null, signal())).rejects.toThrow("expired");
  h.generation = 1;
  const c = new AbortController();
  c.abort();
  await expect(fetchTaskFeedback("subject", 1, null, c.signal)).rejects.toThrow("expired");
});
it("rechecks the personal history and accepts a matching recorded response without resending", async () => {
  h.get.mockResolvedValue({ items: [{ ...row, response: "My response" }], nextCursor: null });
  await expect(
    writeTaskFeedback(
      row,
      "subject",
      1,
      { kind: "response", clientKey: id(4), text: "My response" },
      signal()
    )
  ).resolves.toEqual({ kind: "response" });
  expect(h.put).not.toHaveBeenCalled();
});
it("does not let authors respond or overwrite a different existing response", async () => {
  const request = { kind: "response" as const, clientKey: id(4), text: "My response" };
  await expect(writeTaskFeedback(row, "author", 1, request, signal())).rejects.toThrow("subject");
  h.get.mockResolvedValue({ items: [{ ...row, response: "Already recorded" }], nextCursor: null });
  await expect(writeTaskFeedback(row, "subject", 1, request, signal())).rejects.toThrow(
    "different"
  );
  expect(h.put).not.toHaveBeenCalled();
});
it("writes a response with no automatic retry and validates its receipt", async () => {
  h.put.mockResolvedValue({ ...row, response: "My response" });
  await writeTaskFeedback(
    row,
    "subject",
    1,
    { kind: "response", clientKey: id(4), text: " My response " },
    signal()
  );
  expect(h.put).toHaveBeenCalledWith(
    `/crew-task-feedback/${row.id}/response`,
    expect.objectContaining({ data: { response: "My response" }, retry: false })
  );
  h.put.mockResolvedValue({ ...row, id: id(9), response: "My response" });
  await expect(
    writeTaskFeedback(
      row,
      "subject",
      1,
      { kind: "response", clientKey: id(4), text: "My response" },
      signal()
    )
  ).rejects.toThrow("receipt");
});
it("preserves the appeal ID and verifies the returned case identity", async () => {
  h.post.mockResolvedValue({ feedbackId: row.id, dispute: { id: id(4) } });
  await expect(
    writeTaskFeedback(
      row,
      "subject",
      1,
      { kind: "appeal", clientKey: id(4), text: "Please review" },
      signal()
    )
  ).resolves.toEqual({ kind: "appeal", caseId: id(4) });
  expect(h.post).toHaveBeenCalledWith(
    `/crew-task-feedback/${row.id}/appeals`,
    expect.objectContaining({ data: { id: id(4), reason: "Please review" }, retry: false })
  );
  h.post.mockResolvedValue({ feedbackId: row.id, dispute: { id: id(5) } });
  await expect(
    writeTaskFeedback(
      row,
      "subject",
      1,
      { kind: "appeal", clientKey: id(4), text: "Please review" },
      signal()
    )
  ).rejects.toThrow("receipt");
});
it("keeps the exact pending intent across reopen and refuses changed text", () => {
  let value: string | null = null;
  const store = {
    read: () => value,
    write: (v: string) => {
      value = v;
    },
  };
  const first = feedbackOutbox(row.id, "subject", 1, "appeal", store);
  const request = { kind: "appeal" as const, clientKey: id(4), text: "Please review" };
  first.save(request);
  const restored = feedbackOutbox(row.id, "subject", 1, "appeal", store);
  expect(restored.read()).toEqual(request);
  expect(() => restored.save({ ...request, text: "Different terms" })).toThrow("pending");
  expect(() => restored.clear(id(5))).toThrow("pending");
  restored.clear(id(4));
  expect(restored.read()).toBeNull();
});
it("finds former-member feedback through history pagination without task permission calls", async () => {
  h.get
    .mockResolvedValueOnce({ items: [], nextCursor: id(8) })
    .mockResolvedValueOnce({ items: [row], nextCursor: null });
  h.put.mockResolvedValue({ ...row, response: "My response" });
  await writeTaskFeedback(
    row,
    "subject",
    1,
    { kind: "response", clientKey: id(4), text: "My response" },
    signal()
  );
  expect(h.get.mock.calls.every((call) => call[0] === "/me/crew-task-feedback")).toBe(true);
});
