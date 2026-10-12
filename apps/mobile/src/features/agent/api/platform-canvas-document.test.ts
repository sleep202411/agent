import { beforeEach, expect, it, vi } from "vitest";
import {
  openPlatformCanvasDocument,
  platformCanvasUpdatePending,
  type PlatformCanvasScope,
} from "./platform-canvas-document";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), sections: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
vi.mock("./platform-sections-api", () => ({ fetchPlatformSections: h.sections }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  kind: "platform" as const,
  workspaceId: id(1),
  projectId: id(2),
  sectionId: id(3),
  documentId: id(4),
  generation: 1,
};
const doc = {
  id: scope.documentId,
  workspaceId: scope.workspaceId,
  sectionId: scope.sectionId,
  owner: { kind: "platform_project", projectId: scope.projectId },
  platformProjectId: scope.projectId,
  storyProjectId: null,
  storyChapterId: null,
  type: "canvas",
  status: "active",
  currentSequence: 2,
  snapshotSequence: 1,
  crdtStateBase64: "AAA=",
};
const operation = {
  id: id(5),
  documentId: scope.documentId,
  sequence: 2,
  operationType: "yjs_update",
  yjsUpdateBase64: "AQI=",
};
const sections = {
  canEdit: true,
  sections: [{ id: scope.sectionId, canvasDocumentId: scope.documentId }],
};
const command = { clientKey: id(6), yjsUpdateBase64: "AwQ=" };
const receipt = {
  ...operation,
  sequence: 3,
  clientMutationId: command.clientKey,
  yjsUpdateBase64: command.yjsUpdateBase64,
};
const signal = () => new AbortController().signal;
let stored: string | null;
const storage = {
  read: () => stored,
  write: (value: string) => {
    stored = value;
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  stored = null;
  h.sections.mockResolvedValue(sections);
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/operations") ? { operations: [operation] } : { document: doc }
  );
  h.post.mockResolvedValue({ operation: receipt });
});
it("loads a platform section canvas without invoking Story bootstrap", async () => {
  expect(await openPlatformCanvasDocument(scope, signal())).toEqual({
    document: doc,
    operations: [operation],
    sequence: 2,
  });
  expect(h.post).not.toHaveBeenCalled();
  expect(h.sections).toHaveBeenCalledWith(
    scope.projectId,
    scope.workspaceId,
    1,
    expect.any(AbortSignal)
  );
});
it.each([
  { workspaceId: id(9) },
  { sectionId: id(9) },
  { id: id(9) },
  { platformProjectId: id(9) },
  { owner: { kind: "platform_project", projectId: id(9) } },
  { owner: { kind: "story_project", projectId: scope.projectId } },
  { storyProjectId: scope.projectId },
  { storyChapterId: scope.sectionId },
  { type: "script" },
  { status: "archived" },
  { snapshotSequence: 3 },
])("rejects foreign or invalid document fields %j", async (fields) => {
  h.get.mockResolvedValue({ document: { ...doc, ...fields } });
  await expect(openPlatformCanvasDocument(scope, signal())).rejects.toThrow();
  expect(h.get).toHaveBeenCalledTimes(1);
});
it.each([{ rows: [] }, { rows: [{ id: scope.sectionId, canvasDocumentId: id(9) }] }])(
  "rejects an archived or remapped section",
  async ({ rows }) => {
    h.sections.mockResolvedValue({ ...sections, sections: rows });
    await expect(openPlatformCanvasDocument(scope, signal())).rejects.toThrow("chapter");
    expect(h.get).not.toHaveBeenCalled();
  }
);
it("discards partial history and reloads the same scoped canvas after compaction", async () => {
  h.get
    .mockResolvedValueOnce({ document: doc })
    .mockResolvedValueOnce({ operations: [] })
    .mockResolvedValueOnce({ document: { ...doc, snapshotSequence: 2, crdtStateBase64: "AwQ=" } });
  const result = await openPlatformCanvasDocument(scope, signal());
  expect(result.operations).toEqual([]);
  expect(result.document.crdtStateBase64).toBe("AwQ=");
  expect(h.sections).toHaveBeenCalledTimes(2);
});
it("retains identical bytes through a lost write reply and remount", async () => {
  const first = platformCanvasUpdatePending(scope, "alice", storage);
  h.post.mockImplementationOnce(async () => {
    expect(first.read()).toEqual(command);
    throw Error("reply lost");
  });
  await expect(first.submit(command, signal())).rejects.toThrow("reply lost");
  const resumed = platformCanvasUpdatePending(scope, "alice", storage);
  await resumed.submit(resumed.read()!, signal());
  expect(h.post.mock.calls[0][1].data).toEqual(h.post.mock.calls[1][1].data);
  expect(resumed.read()).toBeNull();
});
it("allows reading but not writing after editor access is revoked", async () => {
  h.sections.mockResolvedValue({ ...sections, canEdit: false });
  await openPlatformCanvasDocument(scope, signal());
  const pending = platformCanvasUpdatePending(scope, "alice", storage);
  await expect(pending.submit(command, signal())).rejects.toThrow("permission");
  expect(h.post).not.toHaveBeenCalled();
  expect(pending.read()).toEqual(command);
});
it.each([{ documentId: id(9) }, { clientMutationId: id(9) }, { yjsUpdateBase64: "AAA=" }])(
  "retains bytes after mismatched acknowledgement %j",
  async (fields) => {
    h.post.mockResolvedValue({ operation: { ...receipt, ...fields } });
    const pending = platformCanvasUpdatePending(scope, "alice", storage);
    await expect(pending.submit(command, signal())).rejects.toThrow("receipt");
    expect(pending.read()).toEqual(command);
  }
);
it("does not dispatch after a session change during section validation", async () => {
  h.sections.mockImplementation(async () => {
    h.generation++;
    return sections;
  });
  await expect(openPlatformCanvasDocument(scope, signal())).rejects.toThrow("session");
  expect(h.get).not.toHaveBeenCalled();
});
it("keeps a pending save when the session changes after dispatch", async () => {
  h.post.mockImplementation(async () => {
    h.generation++;
    return { operation: receipt };
  });
  const pending = platformCanvasUpdatePending(scope, "alice", storage);
  await expect(pending.submit(command, signal())).rejects.toThrow("session");
  expect(JSON.parse(stored!).intent).toEqual(command);
});
it("rejects a Story scope before any transport", async () => {
  await expect(
    openPlatformCanvasDocument(
      { ...scope, kind: "story" } as unknown as PlatformCanvasScope,
      signal()
    )
  ).rejects.toThrow();
  expect(h.sections).not.toHaveBeenCalled();
});
it("does not write if local persistence fails", async () => {
  const pending = platformCanvasUpdatePending(scope, "alice", {
    read: () => null,
    write: () => {
      throw Error("disk full");
    },
  });
  await expect(pending.submit(command, signal())).rejects.toThrow("disk full");
  expect(h.sections).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
