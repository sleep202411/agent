import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchTaskCaseContext,
  openTaskCase,
  taskCaseOutbox,
  type TaskCaseCommand,
} from "./task-case-api";
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
const signal = () => new AbortController().signal;
const task = {
  id: id(1),
  crewId: "crew",
  createdByUserId: "creator",
  approvedByUserId: "approver",
  assignees: [{ userId: "assignee" }],
  submissions: [
    { id: id(2), versionNumber: 1, submittedByUserId: "former", reviewedByUserId: "reviewer" },
  ],
};
const request: TaskCaseCommand = {
  clientKey: id(3),
  respondentUserId: "reviewer",
  title: "Delivery issue",
  message: "Please review evidence",
  submissionIds: [id(2)],
};
const row = {
  id: id(3),
  taskId: id(1),
  openedByUserId: "creator",
  respondentUserId: "reviewer",
  title: request.title,
  status: "open",
  version: 1,
  ownerAdminId: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.stored = null;
  h.get.mockImplementation(async (path: string) =>
    path.startsWith("/crews/") ? { id: "crew", ownerUserId: "owner" } : task
  );
  h.post.mockResolvedValue(row);
});
it("uses creator, approver, owner, assignees and historical submitters/reviewers as participants", async () => {
  const context = await fetchTaskCaseContext("crew", id(1), 1, signal());
  expect(context.participants).toEqual([
    "creator",
    "approver",
    "owner",
    "assignee",
    "former",
    "reviewer",
  ]);
  expect(context.submissions[0]?.id).toBe(id(2));
});
it("rejects wrong Crew/task scope and stale account responses", async () => {
  h.get
    .mockResolvedValueOnce({ ...task, crewId: "other" })
    .mockResolvedValueOnce({ id: "crew", ownerUserId: "owner" });
  await expect(fetchTaskCaseContext("crew", id(1), 1, signal())).rejects.toThrow("scope");
  h.get.mockImplementation(async (path: string) => {
    h.generation = 2;
    return path.startsWith("/crews/") ? { id: "crew", ownerUserId: "owner" } : task;
  });
  await expect(fetchTaskCaseContext("crew", id(1), 1, signal())).rejects.toThrow("expired");
});
it("posts the exact persisted ID and evidence without automatic retry", async () => {
  const box = taskCaseOutbox(id(1), "creator", 1);
  box.save(request);
  await openTaskCase(id(1), "creator", 1, box.read()!, signal());
  expect(h.post).toHaveBeenCalledWith(
    `/crew-tasks/${id(1)}/disputes`,
    expect.objectContaining({
      retry: false,
      data: {
        id: id(3),
        respondentUserId: "reviewer",
        title: request.title,
        message: request.message,
        submissionIds: [id(2)],
      },
    })
  );
  expect(h.get).not.toHaveBeenCalled();
});
it("preserves a lost creation response for exact retry and validates returned identity", async () => {
  const box = taskCaseOutbox(id(1), "creator", 1);
  box.save(request);
  h.post.mockRejectedValueOnce(Error("Response lost"));
  await expect(openTaskCase(id(1), "creator", 1, request, signal())).rejects.toThrow("lost");
  expect(box.read()).toEqual(request);
  h.post.mockResolvedValue({ ...row, id: id(9) });
  await expect(openTaskCase(id(1), "creator", 1, request, signal())).rejects.toThrow("receipt");
  expect(() => box.save({ ...request, title: "changed" })).toThrow();
});
it("rejects self-cases, duplicate/oversized evidence and cancelled sends", async () => {
  await expect(openTaskCase(id(1), "reviewer", 1, request, signal())).rejects.toThrow("another");
  await expect(
    openTaskCase(id(1), "creator", 1, { ...request, submissionIds: [id(2), id(2)] }, signal())
  ).rejects.toThrow();
  await expect(
    openTaskCase(
      id(1),
      "creator",
      1,
      { ...request, submissionIds: Array.from({ length: 21 }, (_, i) => id(i + 10)) },
      signal()
    )
  ).rejects.toThrow();
  const c = new AbortController();
  c.abort();
  await expect(openTaskCase(id(1), "creator", 1, request, c.signal)).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});

it("freezes classification, requested outcome and initial evidence through retries", async () => {
  const input = {
    ...request,
    category: "payment" as const,
    desiredResolution: "payment_allocation" as const,
    attachmentIds: [id(8)],
  };
  const box = taskCaseOutbox(id(1), "creator", 1);
  box.save(input);
  h.post.mockResolvedValue({
    ...row,
    category: input.category,
    desiredResolution: input.desiredResolution,
  });
  await openTaskCase(id(1), "creator", 1, box.read()!, signal());
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    category: "payment",
    desiredResolution: "payment_allocation",
    attachmentIds: [id(8)],
  });
  expect(() => box.save({ ...input, category: "other" })).toThrow();
  h.post.mockResolvedValue({
    ...row,
    category: "other",
    desiredResolution: input.desiredResolution,
  });
  await expect(openTaskCase(id(1), "creator", 1, input, signal())).rejects.toThrow("receipt");
  await expect(
    openTaskCase(id(1), "creator", 1, { ...input, attachmentIds: [id(8), id(8)] }, signal())
  ).rejects.toThrow("Duplicate");
});
