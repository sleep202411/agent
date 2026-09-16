// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { fetchRelationsForUserIds, searchMembers } from "./user-levels-panel";
import { readAllPages } from "./read-all-pages";
const fetchMock = vi.fn();
function response(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ code: 200, data }) });
}
const member = (id: number) => ({
  userId: String(id),
  nickName: `Member ${id}`,
  email: null,
  phone: null,
});
const relation = (id: number) => ({
  id,
  userId: 123,
  userName: "Member",
  levelId: 1,
  levelName: "FD",
  remark: null,
  createTime: null,
  updateTime: null,
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("reads directory matches beyond its initial page", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockImplementationOnce(() =>
      response({
        items: Array.from({ length: 100 }, (_, i) => member(i + 1)),
        total: 101,
        page: 1,
        pageSize: 100,
      })
    )
    .mockImplementationOnce(() =>
      response({ items: [member(101)], total: 101, page: 2, pageSize: 100 })
    );
  const rows = await searchMembers("Member", new AbortController().signal);
  expect(rows).toHaveLength(101);
  expect(rows.at(-1)?.userId).toBe("101");
  expect(fetchMock.mock.calls[1][0]).toContain("page=2");
});
it("reads all relation pages and deduplicates user inputs with stable ordering", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockImplementationOnce(() =>
      response({
        items: Array.from({ length: 100 }, (_, i) => relation(i + 1)),
        total: 101,
        page: 1,
        pageSize: 100,
      })
    )
    .mockImplementationOnce(() =>
      response({ items: [relation(101)], total: 101, page: 2, pageSize: 100 })
    )
    .mockImplementationOnce(() =>
      response({ items: [relation(102)], total: 1, page: 1, pageSize: 100 })
    );
  const rows = await fetchRelationsForUserIds(
    ["123", "123", "456"],
    "1",
    new AbortController().signal
  );
  expect(rows).toHaveLength(102);
  expect(rows[0].id).toBe(102);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[1][0]).toContain("page=2");
  expect(fetchMock.mock.calls[2][0]).toContain("userId=456");
});
it("aborts after a response body and starts no later page or user", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => {
      controller.abort();
      return Promise.resolve({
        code: 200,
        data: { items: [relation(1)], total: 101, page: 1, pageSize: 100 },
      });
    },
  });
  await expect(
    fetchRelationsForUserIds(["123", "456"], "all", controller.signal)
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("rejects a failed later page instead of returning a partial result", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockImplementationOnce(() => response({ items: [member(1)], total: 2, page: 1, pageSize: 1 }))
    .mockRejectedValueOnce(new Error("Page unavailable"));
  await expect(searchMembers("Member", new AbortController().signal)).rejects.toThrow(
    "Page unavailable"
  );
});
it("rejects repeated or mismatched pages and bounds growth to the first walk", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockImplementationOnce(() => response({ items: [member(1)], total: 2, page: 1, pageSize: 1 }))
    .mockImplementationOnce(() => response({ items: [member(1)], total: 2, page: 2, pageSize: 1 }));
  await expect(searchMembers("Member", new AbortController().signal)).rejects.toThrow(
    "no progress"
  );
  fetchMock
    .mockReset()
    .mockImplementationOnce(() => response({ items: [member(1)], total: 2, page: 1, pageSize: 1 }))
    .mockImplementationOnce(() =>
      response({ items: [member(2)], total: 1000, page: 2, pageSize: 1 })
    );
  expect(await searchMembers("Member", new AbortController().signal)).toHaveLength(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock
    .mockReset()
    .mockImplementationOnce(() =>
      response({ items: [member(1)], total: 1, page: 2, pageSize: 100 })
    );
  await expect(
    readAllPages("/fixture", new AbortController().signal, (r: { userId: string }) => r.userId)
  ).rejects.toThrow("inconsistent");
});
