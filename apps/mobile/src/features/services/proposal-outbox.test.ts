import { expect, it, vi } from "vitest";
import { proposalOutbox } from "./proposal-outbox";
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/config", () => ({
  appEnv: { siteRegion: "global", api: { auroraBaseUrl: "https://example.com" } },
}));
it("persists immutable offer terms across sessions and refuses replacement", () => {
  let raw: string | null = null;
  const storage = {
    read: () => raw,
    write: (value: string) => {
      raw = value;
    },
  };
  const terms = {
    clientKey: "key",
    packageTier: "basic" as const,
    price: 12.5,
    currency: "USD" as const,
    deliveryDays: 3,
    revisions: -1,
    scope: ["Edit"],
    note: "Original",
  };
  proposalOutbox("chat", "creator", 1, storage).save(terms);
  const restored = proposalOutbox("chat", "creator", 1, storage);
  expect(restored.read()).toEqual(terms);
  expect(() => restored.save({ ...terms, price: 20 })).toThrow("Another message");
  restored.clear("key");
  expect(restored.read()).toBeNull();
});
