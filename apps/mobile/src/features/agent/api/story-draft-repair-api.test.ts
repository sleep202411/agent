import { beforeEach, expect, it, vi } from "vitest";
import {
  loadStoryRepairDraft,
  storyRepairPending,
  type StoryRepairCommand,
} from "./story-draft-repair-api";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), put: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, put: h.put } }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), chapterId: id(2), generation: 1 };
const content = {
  storyBible: { logline: "Preserve", extra: { enabled: true } },
  productionNotes: ["Keep"],
  graph: {
    entryNodeId: "clip:one",
    nodes: [{ nodeId: "clip:one", name: "Before", interactions: [{ kind: "tap" }] }],
  },
};
const repaired = {
  ...content,
  graph: { ...content.graph, nodes: [{ ...content.graph.nodes[0], name: "After" }] },
};
const draft = {
  ...scope,
  schemaVersion: "interactive-story-draft-v1",
  revision: 4,
  updatedBySessionId: null,
  content,
};
const command = (): StoryRepairCommand => ({
  clientKey: id(3),
  input: {
    schemaVersion: "interactive-story-draft-v1",
    expectedRevision: 4,
    sessionId: id(3),
    content: repaired,
  },
});
let raw: string | null;
const store = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
const signal = () => new AbortController().signal;
const response = (overrides = {}) => ({
  project: { defaultLocale: "en-US", id: id(1), capabilities: ["story.read", "story.edit"] },
  chapter: { id: id(2) },
  draft,
  ...overrides,
});
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  raw = null;
  h.get.mockResolvedValue(response());
  h.put.mockResolvedValue({ ...draft, revision: 5, content: repaired, updatedBySessionId: id(3) });
});
it("loads exactly the requested chapter without stripping fields", async () => {
  const loaded = await loadStoryRepairDraft(scope, signal());
  expect(loaded.draft.content).toEqual(content);
  expect(loaded.defaultLocale).toBe("en-US");
  expect(h.get.mock.calls[0][1]).toMatchObject({ params: { chapterId: id(2) }, retry: false });
});
it("persists before writing and verifies the full versioned receipt", async () => {
  const pending = storyRepairPending(scope, "user", store);
  h.put.mockImplementation(async (_path, options) => {
    expect(JSON.parse(raw!).intent.input).toEqual(options.data);
    expect(options.retry).toBe(false);
    return { ...draft, revision: 5, content: repaired, updatedBySessionId: id(3) };
  });
  expect((await pending.save(command(), signal())).content).toEqual(repaired);
  expect(pending.read()).toBeNull();
});
it("reconciles a lost reply without repeating the write", async () => {
  const pending = storyRepairPending(scope, "user", store);
  h.put.mockRejectedValueOnce(Error("Lost reply"));
  await expect(pending.save(command(), signal())).rejects.toThrow("Lost reply");
  expect(pending.read()).not.toBeNull();
  h.get.mockResolvedValue(
    response({ draft: { ...draft, revision: 5, content: repaired, updatedBySessionId: id(3) } })
  );
  expect((await pending.reconcile(signal())).applied).toBe(true);
  expect(pending.read()).toBeNull();
  expect(h.put).toHaveBeenCalledOnce();
});
it("keeps local intent on remote conflicts without overwriting", async () => {
  h.get.mockResolvedValue(response({ draft: { ...draft, revision: 5 } }));
  const pending = storyRepairPending(scope, "user", store);
  await expect(pending.save(command(), signal())).rejects.toThrow("draft changed");
  expect(pending.read()).toEqual(command());
  expect(h.put).not.toHaveBeenCalled();
  expect((await pending.reconcile(signal())).applied).toBe(false);
});
it("allows read-only review but blocks writes after permission revocation", async () => {
  h.get.mockResolvedValue(
    response({ project: { defaultLocale: "en-US", id: id(1), capabilities: ["story.read"] } })
  );
  expect((await loadStoryRepairDraft(scope, signal())).canEdit).toBe(false);
  const pending = storyRepairPending(scope, "user", store);
  await expect(pending.save(command(), signal())).rejects.toThrow("editing permission");
  expect(h.put).not.toHaveBeenCalled();
  expect(pending.read()).not.toBeNull();
});
it.each([
  { project: { defaultLocale: "en-US", id: id(8), capabilities: ["story.read"] } },
  { chapter: { id: id(8) } },
  { draft: { ...draft, chapterId: id(8) } },
  { project: { defaultLocale: "en-US", id: id(1), capabilities: [] } },
])("rejects mismatched or inaccessible reads", async (overrides) => {
  h.get.mockResolvedValue(response(overrides));
  await expect(loadStoryRepairDraft(scope, signal())).rejects.toThrow();
});
it.each([
  { ...draft, revision: 5, content: repaired, updatedBySessionId: id(9) },
  { ...draft, revision: 5, content, updatedBySessionId: id(3) },
  { ...draft, revision: 6, content: repaired, updatedBySessionId: id(3) },
])("keeps unresolved writes when receipt identity or content differs", async (receipt) => {
  h.put.mockResolvedValue(receipt);
  const pending = storyRepairPending(scope, "user", store);
  await expect(pending.save(command(), signal())).rejects.toThrow("receipt");
  expect(pending.read()).not.toBeNull();
});
it("ignores an old-account reply without clearing its durable repair", async () => {
  h.put.mockImplementation(async () => {
    h.generation = 2;
    return { ...draft, revision: 5, content: repaired, updatedBySessionId: id(3) };
  });
  await expect(storyRepairPending(scope, "user", store).save(command(), signal())).rejects.toThrow(
    "expired"
  );
  expect(JSON.parse(raw!).intent).not.toBeNull();
});
it("aborted work cannot write or discard a repair", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    storyRepairPending(scope, "user", store).save(command(), controller.signal)
  ).rejects.toThrow();
  expect(h.get).not.toHaveBeenCalled();
  expect(h.put).not.toHaveBeenCalled();
  expect(raw).toBeNull();
});

it("blocks duplicate saves and discard while a receipt is pending", async () => {
  let resolve!: (value: unknown) => void;
  h.put.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const pending = storyRepairPending(scope, "user", store);
  const first = pending.save(command(), signal());
  await vi.waitFor(() => expect(h.put).toHaveBeenCalledOnce());
  await expect(pending.save(command(), signal())).rejects.toThrow("already in progress");
  expect(() => pending.discard(id(3))).toThrow("already in progress");
  await expect(pending.reconcile(signal())).rejects.toThrow("already in progress");
  resolve({ ...draft, revision: 5, content: repaired, updatedBySessionId: id(3) });
  await first;
  expect(pending.read()).toBeNull();
});
