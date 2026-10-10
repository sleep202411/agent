import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchMyTaskContracts,
  fetchTaskContracts,
  fetchTaskContractDownload,
  attachTaskContract,
} from "./task-contract-files-api";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  access: vi.fn(),
  detail: vi.fn(),
  generation: 1,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./task-comment-api", () => ({ fetchTaskCommentAccess: h.access }));
vi.mock("./task-detail-api", () => ({ fetchTaskDetail: h.detail }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const signal = () => new AbortController().signal;
const file = {
  id: id(3),
  name: "Original",
  attachedAt: null,
  sizeBytes: "123",
  contentType: "application/pdf",
  available: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue({ canManage: true });
  h.detail.mockResolvedValue({});
});
it("loads retained originals and addenda without signed links", async () => {
  h.get.mockResolvedValue({ items: [file, { ...file, id: id(4), name: "Addendum" }] });
  expect(await fetchTaskContracts(id(1), 1, signal())).toHaveLength(2);
  expect(h.get.mock.calls[0][0]).toBe(`/crew-tasks/${id(1)}/contracts`);
  expect(h.get.mock.calls[0][1]).toMatchObject({
    retry: false,
    cache: "no-store",
    service: "aurora",
  });
});
it("validates archive filtering and supports ACL-empty cursor pages", async () => {
  h.get.mockResolvedValue({ items: [], nextCursor: id(2) });
  expect(await fetchMyTaskContracts("archived", null, 1, signal())).toEqual({
    items: [],
    nextCursor: id(2),
  });
  expect(h.get.mock.calls[0][1].params).toEqual({ lifecycle: "archived", limit: 20 });
  h.get.mockResolvedValue({
    items: [
      {
        id: id(1),
        title: "Task",
        number: 1,
        crew: { id: "crew", name: "Crew" },
        archived: false,
        files: [file],
      },
    ],
    nextCursor: null,
  });
  await expect(fetchMyTaskContracts("archived", null, 1, signal())).rejects.toThrow("lifecycle");
});
it("rechecks management permission and task ownership before the idempotent attachment", async () => {
  h.post.mockResolvedValue({ id: id(3) });
  await attachTaskContract("crew", id(1), "alice", 1, id(2), signal());
  expect(h.access.mock.calls[0].slice(0, 2)).toEqual(["crew", "alice"]);
  expect(h.detail.mock.calls[0].slice(0, 2)).toEqual(["crew", id(1)]);
  expect(h.post.mock.calls[0][1]).toMatchObject({ retry: false, data: { assetNodeId: id(2) } });
  h.access.mockResolvedValue({ canManage: false });
  await expect(attachTaskContract("crew", id(1), "alice", 1, id(2), signal())).rejects.toThrow(
    "permission"
  );
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("rejects unsafe, expired or late download receipts and fetches fresh links", async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  for (const url of ["http://files.test/a", "https://user:pass@files.test/a", "file:///a"]) {
    h.get.mockResolvedValue({ url, expiresAt });
    await expect(fetchTaskContractDownload(id(3), 1, signal())).rejects.toThrow();
  }
  h.get.mockResolvedValue({ url: "https://files.test/a", expiresAt: new Date(0).toISOString() });
  await expect(fetchTaskContractDownload(id(3), 1, signal())).rejects.toThrow("expired");
  h.get.mockResolvedValue({ url: "https://files.test/a", expiresAt });
  expect(await fetchTaskContractDownload(id(3), 1, signal())).toBe("https://files.test/a");
  h.get.mockImplementation(async () => {
    h.generation = 2;
    return { url: "https://files.test/a", expiresAt };
  });
  await expect(fetchTaskContractDownload(id(3), 1, signal())).rejects.toThrow("session expired");
});
