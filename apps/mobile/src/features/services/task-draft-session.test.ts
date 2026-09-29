import { beforeEach, expect, it, vi } from "vitest";
import {
  createTaskDraftSession,
  getTaskDraftSession,
  type TaskDraftInput,
} from "./task-draft-session";
const h = vi.hoisted(() => ({ generation: 1, access: vi.fn(), create: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-create-api", async (original) => ({
  ...(await original<typeof import("./task-create-api")>()),
  createTask: h.create,
}));
const input: TaskDraftInput = {
  title: "Storyboard",
  description: "Episode 1",
  priority: "normal",
  startAt: null,
  dueAt: null,
  parentId: null,
  blockedByTaskIds: [],
  assignees: [],
};
const review = { context: ["Episode 1"], assignees: [], customFields: [] };
const session = () => createTaskDraftSession("crew", "user", h.generation);
beforeEach(() => {
  vi.resetAllMocks();
  h.generation++;
  h.access.mockResolvedValue({ canManage: true });
  h.create.mockResolvedValue({ id: "created" });
});
it("stages immutable validated drafts without server writes", () => {
  const s = session();
  const data = { ...input };
  s.stage(data, review);
  data.title = "changed";
  expect(s.getSnapshot().drafts[0]?.input.title).toBe("Storyboard");
  expect(h.create).not.toHaveBeenCalled();
});
it("creates in order and does not recreate completed drafts", async () => {
  const s = session();
  s.stage(input, review);
  s.stage({ ...input, title: "Music" }, review);
  await s.createAll(() => true);
  await s.createAll(() => true);
  expect(h.create.mock.calls.map((c) => c[1].title)).toEqual(["Storyboard", "Music"]);
  expect(s.getSnapshot().drafts.every((r) => r.state === "created")).toBe(true);
  expect(h.access).toHaveBeenCalledTimes(2);
});
it("locks duplicate batch taps and queue changes", async () => {
  let resolve!: (v: unknown) => void;
  h.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const s = session();
  s.stage(input, review);
  const request = s.createAll(() => true);
  await Promise.resolve();
  await s.createAll(() => true);
  s.stage(input, review);
  s.remove(1);
  expect(s.getSnapshot().drafts).toHaveLength(1);
  expect(h.create).toHaveBeenCalledTimes(1);
  resolve({ id: "created" });
  await request;
});
it("stops at an uncertain write and never retries it", async () => {
  h.create.mockResolvedValueOnce({ id: "first" }).mockRejectedValueOnce(new Error("Response lost"));
  const s = session();
  for (let i = 0; i < 3; i++) s.stage({ ...input, title: `Task ${i}` }, review);
  await s.createAll(() => true);
  expect(s.getSnapshot().drafts.map((r) => r.state)).toEqual(["created", "uncertain", "staged"]);
  await s.createAll(() => true);
  expect(h.create).toHaveBeenCalledTimes(2);
});
it("continues remaining drafts only after explicitly removing an uncertain local attempt", async () => {
  h.create.mockRejectedValueOnce(new Error("Response lost"));
  const s = session();
  s.stage(input, review);
  s.stage({ ...input, title: "Next" }, review);
  await s.createAll(() => true);
  s.remove(1);
  await s.createAll(() => true);
  expect(h.create).toHaveBeenCalledTimes(2);
  expect(h.create.mock.calls[1]?.[1].title).toBe("Next");
});
it("rechecks permission for every creation and preserves unattempted drafts", async () => {
  h.access.mockResolvedValueOnce({ canManage: true }).mockResolvedValueOnce({ canManage: false });
  const s = session();
  s.stage(input, review);
  s.stage(input, review);
  await s.createAll(() => true);
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(s.getSnapshot().drafts[1]?.state).toBe("staged");
  expect(s.getSnapshot().error).toContain("permission");
});
it("stops before writing if the account changes during access lookup", async () => {
  h.access.mockImplementation(async () => {
    h.generation++;
    return { canManage: true };
  });
  const s = session();
  s.stage(input, review);
  await s.createAll(() => true);
  expect(h.create).not.toHaveBeenCalled();
});
it("retains an in-flight receipt on backgrounding but stops later writes", async () => {
  let active = true;
  h.create.mockImplementation(async () => {
    active = false;
    return { id: "created" };
  });
  const s = session();
  s.stage(input, review);
  s.stage(input, review);
  await s.createAll(() => active);
  expect(s.getSnapshot().drafts.map((r) => r.state)).toEqual(["created", "staged"]);
  expect(h.create).toHaveBeenCalledTimes(1);
});
it("does not write when screen leaves during permission lookup", async () => {
  let active = true;
  h.access.mockImplementation(async () => {
    active = false;
    return { canManage: true };
  });
  const s = session();
  s.stage(input, review);
  await s.createAll(() => active);
  expect(h.create).not.toHaveBeenCalled();
});
it("restores the same account/Crew queue and isolates other scopes", () => {
  const a = getTaskDraftSession("crew", "user", h.generation);
  a.stage(input, review);
  expect(getTaskDraftSession("crew", "user", h.generation)).toBe(a);
  expect(getTaskDraftSession("other", "user", h.generation).getSnapshot().drafts).toHaveLength(0);
  expect(getTaskDraftSession("crew", "other", h.generation).getSnapshot().drafts).toHaveLength(0);
  const old = h.generation;
  h.generation++;
  expect(getTaskDraftSession("crew", "user", h.generation).getSnapshot().drafts).toHaveLength(0);
  expect(() => getTaskDraftSession("crew", "user", old)).toThrow("expired");
});
it("notifies subscribers and unsubscribes cleanly", () => {
  const s = session(),
    fn = vi.fn();
  const off = s.subscribe(fn);
  s.stage(input, review);
  expect(fn).toHaveBeenCalledTimes(1);
  off();
  s.remove(1);
  expect(fn).toHaveBeenCalledTimes(1);
});
