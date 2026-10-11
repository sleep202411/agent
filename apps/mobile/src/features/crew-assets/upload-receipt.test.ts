import { beforeEach, expect, it, vi } from "vitest";
import { uploadReceipt } from "./upload-receipt";
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
const file = {
  source: "upload" as const,
  mediaAssetId: "11111111-1111-4111-8111-111111111111",
  name: "Art.png",
};
beforeEach(() => {
  h.generation = 1;
  raw = null;
});
it("restores original media and attempted state across instances without allowing rollback", () => {
  const first = uploadReceipt("crew", "user", 1, null, store);
  first.save({ file, attempted: false });
  const next = uploadReceipt("crew", "user", 1, null, store);
  expect(next.read()).toEqual({ file, attempted: false });
  next.save({ file, attempted: true });
  expect(() => first.save({ file, attempted: false })).toThrow("pending");
  expect(() => first.clear("wrong")).toThrow("pending");
  next.clear(file.mediaAssetId);
  expect(first.read()).toBeNull();
});
it("fails closed on corrupted data and account changes", () => {
  const receipt = uploadReceipt("crew", "user", 1, null, store);
  raw = "broken";
  expect(() => receipt.read()).toThrow();
  expect(() => receipt.save({ file, attempted: false })).toThrow();
  h.generation = 2;
  expect(() => receipt.clear(file.mediaAssetId)).toThrow("expired");
  expect(raw).toBe("broken");
});
