import { beforeEach, expect, it, vi } from "vitest";
import { uploadConfirmation } from "./upload-confirmation";
const h = vi.hoisted(() => ({ generation: 1, confirm: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/lib/media-upload", () => ({ confirmMobileMediaUpload: h.confirm }));
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
const pending = {
  name: "Art.png",
  request: {
    storageKey: "original-key",
    kind: "crew_asset_file",
    contentType: "image/png",
    scope: { crewId: "crew" },
  },
};
const mediaAssetId = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  raw = null;
  h.generation = 1;
  vi.resetAllMocks();
  h.confirm.mockResolvedValue({ mediaAssetId });
});
it("restores and retries the exact confirmation after a lost response", async () => {
  uploadConfirmation("crew", "user", 1, null, store).save(pending);
  const recovered = uploadConfirmation("crew", "user", 1, null, store);
  const signal = new AbortController().signal;
  h.confirm.mockRejectedValueOnce(new Error("Lost response"));
  await expect(recovered.recover(signal)).rejects.toThrow("Lost response");
  expect(recovered.read()).toEqual(pending);
  await expect(recovered.recover(signal)).resolves.toEqual({
    source: "upload",
    name: "Art.png",
    mediaAssetId,
  });
  expect(h.confirm).toHaveBeenNthCalledWith(1, pending.request, signal);
  expect(h.confirm).toHaveBeenNthCalledWith(2, pending.request, signal);
  expect(recovered.read()).toEqual(pending);
  expect(() => recovered.clear("other-key")).toThrow("pending");
  recovered.clear(pending.request.storageKey);
  expect(recovered.read()).toBeNull();
});
it("rejects conflicting requests, wrong scopes, corrupt data and stale accounts", () => {
  const recovery = uploadConfirmation("crew", "user", 1, null, store);
  expect(() =>
    recovery.save({ ...pending, request: { ...pending.request, scope: { crewId: "other" } } })
  ).toThrow("scope");
  recovery.save(pending);
  expect(() => recovery.save({ ...pending, name: "different" })).toThrow("pending");
  h.generation = 2;
  expect(() => recovery.read()).toThrow("expired");
  h.generation = 1;
  raw = "broken";
  expect(() => recovery.save(pending)).toThrow();
});
it("does not return a late acknowledgement after an account change", async () => {
  const recovery = uploadConfirmation("crew", "user", 1, null, store);
  recovery.save(pending);
  h.confirm.mockImplementation(async () => {
    h.generation = 2;
    return { mediaAssetId };
  });
  await expect(recovery.recover(new AbortController().signal)).rejects.toThrow("expired");
  expect(raw).toContain("original-key");
});

it("does not confirm a request replaced in another view", async () => {
  const recovery = uploadConfirmation("crew", "user", 1, null, store);
  recovery.save(pending);
  await expect(recovery.recover(new AbortController().signal, "older-key")).rejects.toThrow(
    "pending"
  );
  expect(h.confirm).not.toHaveBeenCalled();
});
