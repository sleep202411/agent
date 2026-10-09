import { beforeEach, expect, it, vi } from "vitest";
import {
  createTaskDraftSession,
  getTaskDraftSession,
  type TaskDraftInput,
} from "./task-draft-session";
const h = vi.hoisted(() => ({
  generation: 1,
  access: vi.fn(),
  create: vi.fn(),
  apply: vi.fn(),
  canvasApply: vi.fn(),
}));
vi.mock("./canvas-task-import-api", async (original) => ({
  ...(await original<typeof import("./canvas-task-import-api")>()),
  applyCanvasTaskImport: h.canvasApply,
}));
vi.mock("./episode-task-template-api", async (original) => ({
  ...(await original<typeof import("./episode-task-template-api")>()),
  applyEpisodeTaskPlan: h.apply,
}));
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
  const row = s.getSnapshot().drafts[0];
  expect(row?.kind === "task" && row.input.title).toBe("Storyboard");
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
const episodeId = "11111111-1111-4111-8111-111111111111";
const plan = {
  templateId: "22222222-2222-4222-8222-222222222222",
  templateVersion: 2,
  episodeVersion: 3,
  name: "Series",
  items: [
    {
      templateKey: "script",
      title: "Script",
      roleRequirement: "Writer",
      defaultDependencies: [],
      deliveryFields: [],
    },
  ],
};
it("stages an immutable episode command, prevents duplicates, and writes only on confirmation", async () => {
  h.apply.mockResolvedValue({ taskIds: ["task-a"], replayed: false });
  const s = session();
  const data = structuredClone(plan);
  expect(s.stageEpisode(episodeId, "Episode 1", data)).toBe(true);
  data.templateVersion = 99;
  expect(s.stageEpisode(episodeId, "Episode 1", plan)).toBe(false);
  expect(h.apply).not.toHaveBeenCalled();
  await s.createAll(() => true);
  await s.createAll(() => true);
  expect(h.apply).toHaveBeenCalledExactlyOnceWith("crew", episodeId, plan, h.generation);
  expect(s.getSnapshot().drafts[0]).toMatchObject({ state: "created", taskIds: ["task-a"] });
  expect(h.create).not.toHaveBeenCalled();
});
it("retries the exact episode command after a lost reply and pauses later tasks", async () => {
  h.apply
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValue({ taskIds: ["task-a"], replayed: true });
  const s = session();
  s.stageEpisode(episodeId, "Episode 1", plan);
  s.stage(input, review);
  await s.createAll(() => true);
  expect(h.create).not.toHaveBeenCalled();
  expect(s.getSnapshot().drafts[0]).toMatchObject({ state: "staged", error: "Response lost" });
  await s.createAll(() => true);
  expect(h.apply.mock.calls[0]).toEqual(h.apply.mock.calls[1]);
  expect(h.create).toHaveBeenCalledTimes(1);
  expect(s.getSnapshot().drafts.every((r) => r.state === "created")).toBe(true);
});
it("does not start episode creation with revoked permission", async () => {
  h.access.mockResolvedValue({ canManage: false });
  const s = session();
  s.stageEpisode(episodeId, "Episode 1", plan);
  await s.createAll(() => true);
  expect(h.apply).not.toHaveBeenCalled();
  expect(s.getSnapshot().drafts[0]?.state).toBe("staged");
});
it("locks episode batches during a pending write and stops after backgrounding", async () => {
  let resolve!: (value: unknown) => void;
  let active = true;
  h.apply.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const s = session();
  s.stageEpisode(episodeId, "Episode 1", plan);
  s.stage(input, review);
  const request = s.createAll(() => active);
  await Promise.resolve();
  await s.createAll(() => active);
  s.remove(1);
  expect(s.getSnapshot().drafts).toHaveLength(2);
  expect(h.apply).toHaveBeenCalledTimes(1);
  active = false;
  resolve({ taskIds: ["task-a"], replayed: false });
  await request;
  expect(s.getSnapshot().drafts[0]).toMatchObject({ state: "created", taskIds: ["task-a"] });
  expect(h.create).not.toHaveBeenCalled();
});
it("does not post a staged episode after the account changes during authorization", async () => {
  h.access.mockImplementation(async () => {
    h.generation++;
    return { canManage: true };
  });
  const s = session();
  s.stageEpisode(episodeId, "Episode 1", plan);
  await s.createAll(() => true);
  expect(h.apply).not.toHaveBeenCalled();
});

const canvasPreview = {
  crewId: "crew",
  projectId: episodeId,
  title: "Canvas",
  sourceRevision: 3,
  sourceHash: "a".repeat(64),
  plotTree: { nodes: [{ id: "opening", type: "scene", content: { title: "Opening" } }] },
};
it("stages one immutable canvas command and replays it after an uncertain reply", async () => {
  h.canvasApply
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockResolvedValue({ taskIds: ["task-a"], replayed: true });
  const s = session();
  const data = structuredClone(canvasPreview);
  expect(s.stageCanvas(data)).toBe(true);
  data.sourceRevision = 99;
  expect(s.stageCanvas(canvasPreview)).toBe(false);
  expect(h.canvasApply).not.toHaveBeenCalled();
  s.stage(input, review);
  await s.createAll(() => true);
  expect(h.create).not.toHaveBeenCalled();
  await s.createAll(() => true);
  expect(h.canvasApply.mock.calls[0]).toEqual(["crew", canvasPreview, h.generation]);
  expect(h.canvasApply.mock.calls[1]).toEqual(h.canvasApply.mock.calls[0]);
  await s.createAll(() => true);
  expect(h.canvasApply).toHaveBeenCalledTimes(2);
  expect(s.getSnapshot().drafts[0]).toMatchObject({ state: "created", taskIds: ["task-a"] });
});
it("does not stage another crew's canvas", () => {
  expect(() => session().stageCanvas({ ...canvasPreview, crewId: "other" })).toThrow("scope");
});
