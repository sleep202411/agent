import { beforeEach, expect, it, vi } from "vitest";
import { storyChapters } from "./story-chapters-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  generation: 1,
  draft: null as string | null,
  checkpoint: null as string | null,
  scriptPending: null as string | null,
}));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string) => ({
    read: () =>
      namespace === "story-script-checkpoint"
        ? h.checkpoint
        : namespace === "story-script-update"
          ? h.scriptPending
          : h.draft,
    write: vi.fn(),
  }),
}));
const p = "00000000-0000-4000-8000-000000000001",
  a = "00000000-0000-4000-8000-000000000002",
  b = "00000000-0000-4000-8000-000000000003",
  c = "00000000-0000-4000-8000-000000000004";
const chapter = (id: string, rank: number, title = "Chapter") => ({
  id,
  projectId: p,
  rank,
  title,
  nodeCount: 0,
});
let state: {
  project: { id: string; projectVersion: number; capabilities: string[] };
  chapters: ReturnType<typeof chapter>[];
};
let raw: string | null;
const client = () =>
  storyChapters({ projectId: p, generation: 1 }, "owner", {
    read: () => raw,
    write: (v) => {
      raw = v;
    },
  });
const signal = () => new AbortController().signal;
const base = { clientKey: p, expectedProjectVersion: 3 };
const create = { ...base, kind: "create" as const, title: "New", previousIds: [a, b] };
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.draft = null;
  h.checkpoint = null;
  h.scriptPending = null;
  raw = null;
  state = {
    project: { id: p, projectVersion: 3, capabilities: ["story.read", "story.edit"] },
    chapters: [chapter(a, 0), chapter(b, 1)],
  };
  h.get.mockImplementation(async (_path, options) =>
    options?.params?.chapterId
      ? {
          ...state,
          chapter: state.chapters.find((c) => c.id === options.params.chapterId),
          script: { documentId: c },
        }
      : state
  );
});
it("creates once and returns the exact new chapter", async () => {
  h.post.mockImplementation(async () => {
    const row = chapter(c, 2, "New");
    state = {
      ...state,
      project: { ...state.project, projectVersion: 4 },
      chapters: [...state.chapters, row],
    };
    return row;
  });
  const cl = client();
  expect((await cl.save(create, signal())).chapterId).toBe(c);
  expect(cl.pending()).toBeNull();
  expect(h.post).toHaveBeenCalledWith(
    `/story-projects/${p}/chapters`,
    expect.objectContaining({ retry: false, data: { title: "New" } })
  );
});
it("does not repeat unknown creates or infer ownership from a matching title", async () => {
  h.post.mockImplementation(async () => {
    state = {
      ...state,
      project: { ...state.project, projectVersion: 4 },
      chapters: [...state.chapters, chapter(c, 2, "New")],
    };
    throw Error("Lost reply");
  });
  const cl = client();
  await expect(cl.save(create, signal())).rejects.toThrow("Lost reply");
  expect((await cl.load(signal())).pending).toEqual(create);
  await expect(cl.save(create, signal())).rejects.toThrow("may already");
  expect(h.post).toHaveBeenCalledTimes(1);
  await expect(cl.selectCreated(a, signal())).rejects.toThrow("cannot resolve");
  await cl.selectCreated(c, signal());
  expect(cl.pending()).toBeNull();
});
it("renames with the official title-only payload and reconciles a lost response", async () => {
  h.patch.mockImplementation(async () => {
    state = {
      ...state,
      project: { ...state.project, projectVersion: 4 },
      chapters: [chapter(a, 0, "Renamed"), chapter(b, 1)],
    };
    throw Error("Lost");
  });
  const cl = client();
  await expect(
    cl.save({ ...base, kind: "rename", chapterId: a, title: "Renamed" }, signal())
  ).rejects.toThrow("Lost");
  expect((await cl.load(signal())).reconciled).toBe(true);
  expect(h.patch).toHaveBeenCalledWith(
    `/story-projects/${p}/chapters/${a}`,
    expect.objectContaining({ data: { title: "Renamed" } })
  );
});
it("reorders every chapter with the expected version and verifies the result", async () => {
  h.put.mockImplementation(async () => {
    state = {
      ...state,
      project: { ...state.project, projectVersion: 4 },
      chapters: [chapter(b, 0), chapter(a, 1)],
    };
    return state.chapters;
  });
  await client().save({ ...base, kind: "order", chapterIds: [b, a] }, signal());
  expect(h.put).toHaveBeenCalledWith(
    `/story-projects/${p}/chapters/order`,
    expect.objectContaining({ data: { expectedProjectVersion: 3, chapterIds: [b, a] } })
  );
});
it("blocks stale or incomplete orders and read-only users before mutation", async () => {
  await expect(
    client().save({ ...base, kind: "order", chapterIds: [a] }, signal())
  ).rejects.toThrow("every active");
  state.project.projectVersion = 4;
  await expect(
    client().save({ ...base, kind: "order", chapterIds: [b, a] }, signal())
  ).rejects.toThrow("project changed");
  state.project.capabilities = ["story.read"];
  await expect(client().save(create, signal())).rejects.toThrow("editing permission");
  expect(h.put).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
it("protects populated, last and locally edited chapters from archive", async () => {
  const cmd = { ...base, kind: "archive" as const, chapterId: a };
  state.chapters[0]!.nodeCount = 1;
  await expect(client().save(cmd, signal())).rejects.toThrow("empty");
  state.chapters = [chapter(a, 0)];
  await expect(client().save(cmd, signal())).rejects.toThrow("one chapter");
  state.chapters = [chapter(a, 0), chapter(b, 1)];
  h.draft = '{"draft":true}';
  await expect(client().save(cmd, signal())).rejects.toThrow("local graph");
  expect(h.post).not.toHaveBeenCalled();
});
it("archives an empty chapter and reconciles the active list after a lost reply", async () => {
  h.post.mockImplementation(async () => {
    state = {
      ...state,
      project: { ...state.project, projectVersion: 4 },
      chapters: [chapter(b, 0)],
    };
    throw Error("Lost archive");
  });
  const cl = client();
  await expect(cl.save({ ...base, kind: "archive", chapterId: a }, signal())).rejects.toThrow(
    "Lost archive"
  );
  expect((await cl.load(signal())).reconciled).toBe(true);
  expect(cl.pending()).toBeNull();
});
it("rejects cross-project data and expired accounts", async () => {
  state.chapters[0]!.projectId = c;
  await expect(client().load(signal())).rejects.toThrow("identity");
  h.generation = 2;
  await expect(client().save(create, signal())).rejects.toThrow("expired");
  expect(h.post).not.toHaveBeenCalled();
});
it("retains an unverifiable creation receipt without allowing a blind retry", async () => {
  h.post.mockResolvedValue(chapter(a, 0, "New"));
  const cl = client();
  await expect(cl.save(create, signal())).rejects.toThrow("receipt mismatch");
  expect(cl.pending()).toEqual(create);
  await expect(cl.save(create, signal())).rejects.toThrow("may already");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("rejects a wrong order receipt and keeps the original command", async () => {
  const command = { ...base, kind: "order" as const, chapterIds: [b, a] };
  h.put.mockResolvedValue(state.chapters);
  const cl = client();
  await expect(cl.save(command, signal())).rejects.toThrow("receipt mismatch");
  expect(cl.pending()).toEqual(command);
});
it("does not mutate when title validation or cancellation fails", async () => {
  await expect(client().save({ ...create, title: " " }, signal())).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(client().save(create, controller.signal)).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("keeps chapters reachable while Script edits or update receipts are pending", async () => {
  const command = { ...base, kind: "archive" as const, chapterId: a };
  h.checkpoint = JSON.stringify({
    version: 1,
    state: "AAAA",
    pending: [{ clientKey: p, yjsUpdateBase64: "AAAA" }],
  });
  await expect(client().save(command, signal())).rejects.toThrow("finish syncing");
  h.checkpoint = JSON.stringify({ version: 1, state: "AAAA", pending: [] });
  h.scriptPending = JSON.stringify({
    version: 1,
    intent: { clientKey: p, yjsUpdateBase64: "AAAA" },
  });
  await expect(client().save(command, signal())).rejects.toThrow("finish syncing");
  expect(h.post).not.toHaveBeenCalled();
});
it("allows archive after Script synchronization and uses only the selected chapter's document", async () => {
  h.checkpoint = JSON.stringify({ version: 1, state: "AAAA", pending: [] });
  h.scriptPending = JSON.stringify({ version: 1, intent: null });
  h.post.mockImplementation(async () => {
    const archived = state.chapters[0]!;
    state = {
      ...state,
      project: { ...state.project, projectVersion: 4 },
      chapters: [chapter(b, 0)],
    };
    return archived;
  });
  await client().save({ ...base, kind: "archive", chapterId: a }, signal());
  expect(h.get).toHaveBeenCalledWith(
    `/story-projects/${p}/workbench`,
    expect.objectContaining({ params: { chapterId: a }, retry: false })
  );
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post).toHaveBeenCalledWith(
    `/story-projects/${p}/chapters/${a}/archive`,
    expect.anything()
  );
});
it("refuses archive when focused Script metadata is stale, foreign or unreadable", async () => {
  for (const change of [
    { chapter: chapter(b, 0) },
    { project: { ...state.project, projectVersion: 4 } },
    { script: {} },
  ]) {
    h.get.mockImplementation(async (_path, options) =>
      options?.params
        ? { ...state, chapter: chapter(a, 0), script: { documentId: c }, ...change }
        : state
    );
    await expect(
      client().save({ ...base, kind: "archive", chapterId: a }, signal())
    ).rejects.toThrow();
  }
  expect(h.post).not.toHaveBeenCalled();
});
