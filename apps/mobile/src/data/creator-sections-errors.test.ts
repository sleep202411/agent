import { beforeEach, expect, it, vi } from "vitest";
import { fetchCreatorServices } from "./creator-service-api";
import { fetchCreatorIps } from "./ip-api";
import { fetchCrewsByUser } from "./crew-api";
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
  ApiRequestError: class extends Error {},
}));
vi.mock("@/config", () => ({ appEnv: { assets: {} }, resolveAssetUrl: (p: string) => p }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
beforeEach(() => {
  h.get.mockReset();
});
it.each([
  ["services", () => fetchCreatorServices(12, { creatorId: "artist" })],
  ["IPs", () => fetchCreatorIps("artist")],
  ["crews", () => fetchCrewsByUser("artist")],
] as const)("preserves %s transport errors and genuine empty results", async (_name, load) => {
  h.get.mockRejectedValueOnce(new Error("Upstream unavailable"));
  await expect(load()).rejects.toThrow("Upstream unavailable");
  h.get.mockResolvedValue({ items: [] });
  await expect(load()).resolves.toEqual([]);
});
