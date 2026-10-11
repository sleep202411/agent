import { beforeEach, expect, it, vi } from "vitest";
import {
  loadPlotImportDraft,
  plotImportPending,
  type PlotImportCommand,
} from "./story-plot-import-api";
import { parseStoryPlotImportValue } from "../lib/story-plot-import";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { projectId: id(1), chapterId: id(2), generation: 1 };
const content = {
  storyBible: { logline: "Keep me" },
  productionNotes: ["Keep me too"],
  graph: { entryNodeId: null, nodes: [] },
};
const draft = {
  ...scope,
  schemaVersion: "interactive-story-draft-v1",
  content,
  revision: 4,
  updatedBySessionId: null,
};
const command = (): PlotImportCommand => ({
  clientKey: id(3),
  name: "plot.json",
  input: {
    schemaVersion: "interactive-story-draft-v1",
    content,
    expectedRevision: 4,
    sessionId: id(3),
    locale: "en-US",
    mode: "append",
    plot: parseStoryPlotImportValue({
      entryNodeId: "scene",
      assets: [],
      nodes: [{ id: "scene", type: "scene", title: "Scene", next: null }],
    }),
  },
});
let raw: string | null,
  storage: { read: () => string | null; write: ReturnType<typeof vi.fn<(value: string) => void>> };
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  raw = null;
  storage = {
    read: () => raw,
    write: vi.fn((value: string) => {
      raw = value;
    }),
  };
  h.get.mockResolvedValue({
    project: { id: id(1), capabilities: ["story.edit"] },
    chapter: { id: id(2) },
    draft,
  });
  h.post.mockResolvedValue({
    draft: {
      ...draft,
      revision: 5,
      updatedBySessionId: id(3),
      content: { ...content, graph: { entryNodeId: "imported", nodes: [{ nodeId: "imported" }] } },
    },
    importedNodeIds: ["imported"],
  });
});
it("loads only the requested chapter with current edit permission and preserves content", async () => {
  expect((await loadPlotImportDraft(scope, signal())).content).toEqual(content);
  expect(h.get.mock.calls[0][1].params).toEqual({ chapterId: id(2) });
  h.get.mockResolvedValueOnce({
    project: { id: id(1), capabilities: [] },
    chapter: { id: id(2) },
    draft,
  });
  await expect(loadPlotImportDraft(scope, signal())).rejects.toThrow("permission");
});
it("rejects another chapter and expired sessions", async () => {
  h.get.mockResolvedValueOnce({
    project: { id: id(1), capabilities: ["story.edit"] },
    chapter: { id: id(2) },
    draft: { ...draft, chapterId: id(8) },
  });
  await expect(loadPlotImportDraft(scope, signal())).rejects.toThrow("mismatch");
  h.generation = 2;
  await expect(loadPlotImportDraft(scope, signal())).rejects.toThrow("expired");
});
it.each(["append", "replace"] as const)(
  "persists %s intent before sending and clears only its matching receipt",
  async (mode) => {
    const c = command();
    c.input.mode = mode;
    h.post.mockImplementationOnce(async () => {
      expect(JSON.parse(raw!).intent.input).toEqual(c.input);
      return {
        draft: {
          ...draft,
          revision: 5,
          updatedBySessionId: id(3),
          content: {
            ...content,
            graph: { entryNodeId: "imported", nodes: [{ nodeId: "imported" }] },
          },
        },
        importedNodeIds: ["imported"],
      };
    });
    const pending = plotImportPending(scope, "user", storage);
    await pending.submit(c, signal());
    expect(h.post.mock.calls[0][1].data).toEqual(c.input);
    expect(pending.read()).toBeNull();
  }
);
it("retains lost responses across reopening and refuses automatic replay", async () => {
  h.post.mockRejectedValueOnce(Error("Response lost"));
  await expect(
    plotImportPending(scope, "user", storage).submit(command(), signal())
  ).rejects.toThrow("Response lost");
  const reopened = plotImportPending(scope, "user", storage);
  expect(reopened.read()).toEqual(command());
  await expect(reopened.submit(command(), signal())).rejects.toThrow("Review");
  expect(h.post).toHaveBeenCalledOnce();
  reopened.clear(id(3));
  expect(reopened.read()).toBeNull();
});
it("does not dispatch after storage failure", async () => {
  storage.write.mockImplementation(() => {
    throw Error("Full");
  });
  await expect(
    plotImportPending(scope, "user", storage).submit(command(), signal())
  ).rejects.toThrow("Full");
  expect(h.post).not.toHaveBeenCalled();
});
it.each(["revision", "session", "nodes"])(
  "retains requests after %s receipt mismatch",
  async (kind) => {
    h.post.mockResolvedValueOnce({
      draft: {
        ...draft,
        revision: kind === "revision" ? 8 : 5,
        updatedBySessionId: kind === "session" ? id(8) : id(3),
        content: {
          ...content,
          graph: { entryNodeId: null, nodes: kind === "nodes" ? [] : [{ nodeId: "imported" }] },
        },
      },
      importedNodeIds: ["imported"],
    });
    const pending = plotImportPending(scope, "user", storage);
    await expect(pending.submit(command(), signal())).rejects.toThrow("receipt mismatch");
    expect(pending.read()).toEqual(command());
  }
);
it("keeps corrupt records and blocks writes", async () => {
  raw = "broken";
  await expect(
    plotImportPending(scope, "user", storage).submit(command(), signal())
  ).rejects.toThrow();
  expect(raw).toBe("broken");
  expect(h.post).not.toHaveBeenCalled();
});
