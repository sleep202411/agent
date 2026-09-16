import { afterEach, expect, it, vi } from "vitest";
import { fetchUsersByIds } from "./users-api";
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mock }));
afterEach(() => {
  mock.get.mockReset();
});
it("resolves large contributor lists within the server's fifty-user limit", async () => {
  mock.get.mockImplementation(async (_path, options) => {
    const ids = options.params.ids.split(",") as string[];
    if (ids.length > 50) throw new Error("Too many ids (max 50 per request)");
    return { users: ids.map((userId) => ({ userId, nickname: `User ${userId}`, avatar: null })) };
  });
  const ids = Array.from({ length: 111 }, (_, i) => String(i + 1));
  const result = await fetchUsersByIds([...ids, "1", ""]);
  expect(result.map((user) => user.userId)).toEqual(ids);
  expect(mock.get).toHaveBeenCalledTimes(3);
});
it("preserves omitted users and does not make requests for an empty selection", async () => {
  await expect(fetchUsersByIds([])).resolves.toEqual([]);
  expect(mock.get).not.toHaveBeenCalled();
  mock.get.mockResolvedValue({ users: [{ userId: "2", nickname: "Two", avatar: null }] });
  await expect(fetchUsersByIds(["1", "2"])).resolves.toEqual([
    { userId: "2", nickname: "Two", avatar: null },
  ]);
});
it("stops queued batches after query cancellation", async () => {
  const controller = new AbortController();
  mock.get.mockImplementation(async () => {
    controller.abort();
    return { users: [] };
  });
  await expect(
    fetchUsersByIds(
      Array.from({ length: 51 }, (_, i) => String(i + 1)),
      controller.signal
    )
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(mock.get).toHaveBeenCalledTimes(1);
  expect(mock.get.mock.calls[0]![1].signal).toBe(controller.signal);
});
