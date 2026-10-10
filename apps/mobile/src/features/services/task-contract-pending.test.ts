import { beforeEach, expect, it, vi } from "vitest";
import { taskContractPending } from "./task-contract-pending";
const h = vi.hoisted(() => ({ generation: 1, data: new Map<string, string>() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string, user: string, task: string) => {
    const key = JSON.stringify([namespace, user, task]);
    return { read: () => h.data.get(key), write: (value: string) => h.data.set(key, value) };
  },
}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
beforeEach(() => {
  h.generation = 1;
  h.data.clear();
});
it("restores an uncertain attachment without changing its immutable task and asset", () => {
  const store = taskContractPending(id(1), "alice", 1);
  store.save({ assetNodeId: id(2), attempted: false });
  store.save({ assetNodeId: id(2), attempted: true });
  const resumed = taskContractPending(id(1), "alice", 1);
  expect(resumed.read()).toEqual({ assetNodeId: id(2), attempted: true });
  expect(() => resumed.clear(id(2))).toThrow("Retry");
  expect(() => resumed.save({ assetNodeId: id(3), attempted: true })).toThrow("pending");
  expect(() => resumed.save({ assetNodeId: id(2), attempted: false })).toThrow("pending");
  resumed.clear(id(2), true);
  expect(resumed.read()).toBeNull();
});
it("isolates task, account and session and lets unsubmitted selections be cleared", () => {
  const store = taskContractPending(id(1), "alice", 1);
  store.save({ assetNodeId: id(2), attempted: false });
  expect(taskContractPending(id(3), "alice", 1).read()).toBeNull();
  expect(taskContractPending(id(1), "bob", 1).read()).toBeNull();
  store.clear(id(2));
  expect(store.read()).toBeNull();
  h.generation = 2;
  expect(() => store.read()).toThrow("expired");
});
