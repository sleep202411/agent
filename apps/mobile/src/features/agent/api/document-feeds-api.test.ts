import { beforeEach, expect, it, vi } from "vitest";
import { listDocumentThreads, listDocumentVersions } from "./document-feeds-api";
const h = vi.hoisted(() => ({ get: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const uuid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;
const doc = uuid(1),
  date = "2026-10-05T00:00:00Z";
const comment = {
  id: uuid(3),
  threadId: uuid(2),
  documentId: doc,
  body: "Keep this\n细节",
  createdById: "42",
  createdAt: date,
  editedAt: null,
};
const thread = {
  id: uuid(2),
  documentId: doc,
  blockId: "node-1",
  anchor: { x: 1 },
  title: null,
  status: "open",
  createdById: "42",
  resolvedById: null,
  resolvedAt: null,
  createdAt: date,
  updatedAt: date,
  comments: [comment],
};
const version = {
  id: uuid(4),
  documentId: doc,
  versionNumber: 1,
  schemaVersion: "1",
  sequence: 0,
  title: null,
  label: null,
  source: "manual",
  sourceId: null,
  snapshot: {},
  metadata: null,
  createdById: "42",
  createdAt: date,
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("reads anchored threads without altering authored text", async () => {
  h.get.mockResolvedValue({ threads: [thread] });
  const s = signal();
  expect(await listDocumentThreads(doc, 1, s)).toEqual([thread]);
  expect(h.get).toHaveBeenCalledWith(`/documents/${doc}/comments`, {
    service: "aurora",
    signal: s,
    retry: false,
  });
});
it("reads the server's version history without inventing restoration actions", async () => {
  h.get.mockResolvedValue({ versions: [version] });
  expect(await listDocumentVersions(doc, 1, signal())).toEqual([version]);
});
it.each([listDocumentThreads, listDocumentVersions])(
  "preserves upstream read errors",
  async (read) => {
    const error = Object.assign(new Error("Document access revoked"), { status: 403 });
    h.get.mockRejectedValue(error);
    await expect(read(doc, 1, signal())).rejects.toBe(error);
  }
);
it.each([listDocumentThreads, listDocumentVersions])(
  "rejects old accounts and cancelled requests",
  async (read) => {
    h.generation = 2;
    await expect(read(doc, 1, signal())).rejects.toThrow("session");
    expect(h.get).not.toHaveBeenCalled();
    h.generation = 1;
    const c = new AbortController();
    h.get.mockImplementation(async () => {
      c.abort();
      return { threads: [], versions: [] };
    });
    await expect(read(doc, 1, c.signal)).rejects.toThrow();
    h.get.mockImplementation(async () => {
      h.generation = 2;
      return { threads: [], versions: [] };
    });
    await expect(read(doc, 1, signal())).rejects.toThrow("session");
  }
);
it.each(
  [
    [{ ...thread, documentId: uuid(9) }],
    [thread, thread],
    [{ ...thread, comments: [{ ...comment, documentId: uuid(9) }] }],
    [{ ...thread, comments: [{ ...comment, threadId: uuid(9) }] }],
    [{ ...thread, comments: [comment, comment] }],
  ].map((threads) => ({ threads }))
)("rejects foreign or duplicated thread/comment identities", async ({ threads }) => {
  h.get.mockResolvedValue({ threads });
  await expect(listDocumentThreads(doc, 1, signal())).rejects.toThrow();
});
it.each(
  [
    [{ ...version, documentId: uuid(9) }],
    [version, version],
    [version, { ...version, id: uuid(5) }],
    [{ ...version, source: "unknown" }],
  ].map((versions) => ({ versions }))
)("rejects invalid version history", async ({ versions }) => {
  h.get.mockResolvedValue({ versions });
  await expect(listDocumentVersions(doc, 1, signal())).rejects.toThrow();
});
