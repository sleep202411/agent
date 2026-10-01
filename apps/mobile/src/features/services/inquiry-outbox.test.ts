import { beforeEach, expect, it, vi } from "vitest";
import { inquiryOutbox } from "./inquiry-outbox";
const h = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://example.com" } },
}));
let raw: string | null;
const store = {
  read: () => raw,
  write: (value: string) => {
    raw = value;
  },
};
beforeEach(() => {
  raw = null;
  h.generation = 1;
});
it("preserves one immutable inquiry across restarts and clears only its receipt", () => {
  const first = inquiryOutbox("service", "buyer", 1, store);
  first.save({ body: "Original inquiry", clientKey: "original-key" });
  const restored = inquiryOutbox("service", "buyer", 1, store);
  expect(restored.read()).toEqual({ body: "Original inquiry", clientKey: "original-key" });
  expect(() => restored.save({ body: "Changed inquiry", clientKey: "other-key" })).toThrow(
    "pending"
  );
  expect(() => restored.clear("other-key")).toThrow("pending");
  restored.clear("original-key");
  expect(first.read()).toBeNull();
});
it("rejects stale accounts and corrupt records without replacing them", () => {
  const outbox = inquiryOutbox("service", "buyer", 1, store);
  raw = "broken";
  expect(() => outbox.read()).toThrow();
  expect(() => outbox.save({ body: "Hello", clientKey: "key" })).toThrow();
  h.generation = 2;
  expect(() => outbox.clear("key")).toThrow("expired");
  expect(raw).toBe("broken");
});
