import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ generation: 1, read: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("./billing-api", () => ({
  getBillingOrder: h.read,
  isOrderFulfilled: (status: string) => status === "fulfilled",
  isOrderDead: (status: string) => status === "expired",
}));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  h.generation = 1;
});
afterEach(() => vi.useRealTimers());
it("shares one polling operation for the same account and order", async () => {
  h.read.mockResolvedValueOnce({ status: "pending" }).mockResolvedValue({ status: "fulfilled" });
  const { followWechatOrderUntilSettled: follow } = await import("./wechat-order-follow");
  const first = follow("order");
  expect(follow("order")).toBe(first);
  await vi.runAllTimersAsync();
  expect(await first).toBe("fulfilled");
  expect(h.read).toHaveBeenCalledTimes(2);
});
it.each(["fulfilled", "expired"])(
  "rejects a late %s result after account replacement",
  async (status) => {
    let finish!: (value: { status: string }) => void;
    h.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { followWechatOrderUntilSettled: follow } = await import("./wechat-order-follow");
    const operation = follow("order");
    h.generation = 2;
    finish({ status });
    expect(await operation).toBe("aborted");
    expect(vi.getTimerCount()).toBe(0);
  }
);
it("does not share the previous account's pending order read", async () => {
  let finish!: (value: { status: string }) => void;
  h.read
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ status: "expired" });
  const { followWechatOrderUntilSettled: follow } = await import("./wechat-order-follow");
  const old = follow("order");
  h.generation = 2;
  expect(await follow("order")).toBe("dead");
  finish({ status: "fulfilled" });
  expect(await old).toBe("aborted");
  expect(h.read).toHaveBeenCalledTimes(2);
});
it("stops before the next read when the account changes between polls", async () => {
  h.read.mockResolvedValue({ status: "pending" });
  const { followWechatOrderUntilSettled: follow } = await import("./wechat-order-follow");
  const operation = follow("order");
  await vi.advanceTimersByTimeAsync(0);
  h.generation = 2;
  await vi.runAllTimersAsync();
  expect(await operation).toBe("aborted");
  expect(h.read).toHaveBeenCalledTimes(1);
});
it("bounds transient errors and releases the finished operation for an explicit retry", async () => {
  h.read.mockRejectedValue(new Error("Temporary failure"));
  const { followWechatOrderUntilSettled: follow } = await import("./wechat-order-follow");
  const operation = follow("order");
  await vi.runAllTimersAsync();
  expect(await operation).toBe("timeout");
  expect(h.read).toHaveBeenCalledTimes(8);
  h.read.mockResolvedValue({ status: "fulfilled" });
  expect(await follow("order")).toBe("fulfilled");
});
