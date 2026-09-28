import { beforeEach, expect, it, vi } from "vitest";
import { createHappyOysterRuntime } from "./happy-oyster-runtime";
import { FAL_HAPPY_OYSTER_PROVIDER_KEY } from "@repo/shared/world-model-protocol";
const mock = vi.hoisted(() => ({ end: vi.fn(), can: vi.fn(), off: vi.fn() }));
vi.mock("@happy-oyster/js-sdk", () => ({
  HappyOysterEngine: class {
    createTravel() {
      return { end: mock.end, can: mock.can, on: () => mock.off };
    }
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mock.can.mockReturnValue(true);
  mock.end.mockResolvedValue(undefined);
});
const create = () =>
  createHappyOysterRuntime({
    providerKey: FAL_HAPPY_OYSTER_PROVIDER_KEY,
    connection: { apiBaseUrl: "https://example.test", token: "test", ticket: "test" } as any,
    videoElement: {} as HTMLVideoElement,
    maxExperienceSeconds: null,
  });
it("retries SDK cleanup after a rejected dispose", async () => {
  const runtime = await create();
  mock.end.mockRejectedValueOnce(new Error("end failed"));
  await expect(runtime.dispose()).rejects.toThrow("end failed");
  await runtime.dispose();
  expect(mock.end).toHaveBeenCalledTimes(2);
  expect(mock.off).toHaveBeenCalledTimes(3);
});
it("concurrent cleanup callers both observe the pending SDK failure", async () => {
  const runtime = await create();
  let reject!: (reason: Error) => void;
  mock.end.mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      })
  );
  const first = runtime.end();
  const second = runtime.end();
  const results = Promise.allSettled([first, second]);
  await Promise.resolve();
  expect(runtime.can("end")).toBe(false);
  reject(new Error("end failed"));
  expect((await results).map((r) => r.status)).toEqual(["rejected", "rejected"]);
  expect(mock.end).toHaveBeenCalledOnce();
});
it("successful ending remains idempotent", async () => {
  const runtime = await create();
  await runtime.end();
  await runtime.dispose();
  await runtime.dispose();
  expect(mock.end).toHaveBeenCalledOnce();
  expect(mock.off).toHaveBeenCalledTimes(3);
  expect(runtime.can("start")).toBe(false);
});
