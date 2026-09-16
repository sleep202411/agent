import { expect, it, vi } from "vitest";
import { fetchIpDetail } from "./ip-api";
import { api } from "@/lib/api-client";
vi.mock("@/config", () => ({ appEnv: {}, resolveAssetUrl: (value: string) => value }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn() },
  ApiRequestError: class extends Error {},
}));
it.each([false, true])(
  "resolves later contributors and keeps failed-batch snapshots (failure=%s)",
  async (failFirst) => {
    const ids = Array.from({ length: 101 }, (_, i) => String(i + 1));
    const batches: string[][] = [];
    vi.mocked(api.get).mockImplementation(async (path, options) => {
      if (path === "/ip-commerce/ips/ip")
        return {
          ip: {
            id: "ip",
            title: "IP",
            contributors: ids.map((userId) => ({
              userId,
              isPublic: true,
              displayName: `Saved ${userId}`,
              role: "actor",
            })),
          },
        };
      const batch = String(options?.params?.ids).split(",");
      batches.push(batch);
      expect(batch.length).toBeLessThanOrEqual(50);
      if (failFirst && batch[0] === "1") throw new Error("unavailable");
      return {
        users: batch.map((userId) => ({ userId, nickname: `Live ${userId}`, avatar: null })),
      };
    });
    const detail = await fetchIpDetail("ip");
    expect(detail?.cast.map((person) => person.name)).toEqual(
      ids.map((id, i) => `${failFirst && i < 50 ? "Saved" : "Live"} ${id}`)
    );
    expect(batches.map((batch) => batch.length)).toEqual([50, 50, 1]);
  }
);
