import { beforeEach, expect, it, vi } from "vitest";
import { withdrawalPending } from "./withdrawal-pending";
import { withdrawalSecureRecord } from "./withdrawal-secure-record";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
const command = {
  requestId: "00000000-0000-4000-8000-000000000001",
  currency: "USD" as const,
  percentageBps: 5000,
  expectedAvailableAmountMinor: "10000",
  recipient: {
    fullName: "Creator",
    accountNumber: "1234",
    address: "地址😀".repeat(200),
    swift: "DBSSSGSG",
    branchAddress: "地址".repeat(400),
  },
};
let data: Map<string, string>;
const storage = {
  get: (key: string) => data.get(key) ?? null,
  set: (key: string, value: string) => {
    data.set(key, value);
  },
};
beforeEach(() => {
  h.generation = 1;
  data = new Map();
});
it("restores the exact original request after restart using bounded Unicode-safe secure chunks", () => {
  const first = withdrawalPending(1, withdrawalSecureRecord("alice", storage));
  first.save(command);
  expect([...data.values()].every((v) => new TextEncoder().encode(v).length < 2048)).toBe(true);
  const restored = withdrawalPending(1, withdrawalSecureRecord("alice", storage));
  expect(restored.read()).toEqual(command);
  expect(() => restored.save({ ...command, percentageBps: 10000 })).toThrow("pending");
  expect(() => restored.clear("other")).toThrow("pending");
  restored.clear(command.requestId);
  expect(restored.read()).toBeNull();
  expect([...data.values()].join("")).not.toContain("Creator");
});
it("isolates accounts and rejects foreign generations", () => {
  withdrawalPending(1, withdrawalSecureRecord("alice", storage)).save(command);
  expect(withdrawalPending(1, withdrawalSecureRecord("bob", storage)).read()).toBeNull();
  h.generation = 2;
  expect(() => withdrawalPending(1, withdrawalSecureRecord("alice", storage)).read()).toThrow(
    "expired"
  );
});
it("fails closed when committed secure storage is incomplete or corrupted", () => {
  const store = withdrawalPending(1, withdrawalSecureRecord("alice", storage));
  store.save(command);
  data.delete("alice.1");
  expect(() => store.read()).toThrow("incomplete");
  data.set("alice.1", "corrupt");
  expect(() => store.read()).toThrow("mismatch");
});
it("never commits partial storage before a new request is ready to send", () => {
  let writes = 0;
  const record = withdrawalSecureRecord("alice", {
    ...storage,
    set: (key, value) => {
      if (++writes === 2) throw Error("Storage full");
      storage.set(key, value);
    },
  });
  expect(() => withdrawalPending(1, record).save(command)).toThrow("Storage full");
  expect(record.read()).toBeNull();
  expect(withdrawalPending(1, withdrawalSecureRecord("alice", storage)).read()).toBeNull();
});
