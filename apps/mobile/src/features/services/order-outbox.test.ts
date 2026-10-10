import { beforeEach, expect, it, vi } from "vitest";
import { orderOutbox } from "./order-outbox";
import { orderPayload } from "./order-api";
import { service } from "./order-fixture.test-helper";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://example.com" } },
}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
let raw: string | null;
const store = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
const pending = {
  clientKey: "original-key",
  payload: orderPayload(service, "premium", { brief: "Original brief" }, "Note", "original-key"),
  offer: { packages: service.packages, requirementQuestions: service.requirementQuestions },
};
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("retains the exact versioned order and displayed offer across restarts", () => {
  const first = orderOutbox(service.id, "buyer", 1, store);
  first.save(pending);
  const restored = orderOutbox(service.id, "buyer", 1, store);
  expect(restored.read()).toEqual(pending);
  expect(() =>
    restored.save({ ...pending, payload: { ...pending.payload, note: "Changed" } })
  ).toThrow("pending");
  expect(() => restored.clear("other-key")).toThrow("pending");
  restored.clear(pending.clientKey);
  expect(first.read()).toBeNull();
});
it("rejects mismatching keys, services and stale sessions without replacing a saved order", () => {
  const outbox = orderOutbox(service.id, "buyer", 1, store);
  expect(() => outbox.save({ ...pending, clientKey: "different-key" })).toThrow("match");
  expect(() =>
    outbox.save({ ...pending, payload: { ...pending.payload, serviceId: "other" } })
  ).toThrow("match");
  outbox.save(pending);
  h.generation = 2;
  expect(() => outbox.clear(pending.clientKey)).toThrow("expired");
  h.generation = 1;
  expect(outbox.read()).toEqual(pending);
});
