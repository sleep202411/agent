import { beforeEach, expect, it, vi } from "vitest";
import { reportIpContent } from "./ip-api";
import { api } from "@/lib/api-client";
vi.mock("@/config", () => ({ appEnv: {}, resolveAssetUrl: (value: string) => value }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/api-client", () => ({
  api: { post: vi.fn() },
  ApiRequestError: class extends Error {},
}));
beforeEach(() => vi.resetAllMocks());
it.each(["ip", "episode"] as const)(
  "sends the official %s report with trimmed optional details",
  async (targetType) => {
    await reportIpContent({
      targetType,
      targetId: "target",
      reason: "privacy",
      description: "  Details  ",
    });
    expect(api.post).toHaveBeenCalledExactlyOnceWith("/ip-commerce/reports", {
      service: "aurora",
      data: { targetType, targetId: "target", reason: "privacy", description: "Details" },
    });
  }
);
it("omits whitespace-only details and exposes server rejection", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Content is unavailable"));
  await expect(
    reportIpContent({ targetType: "ip", targetId: "ip", reason: "other", description: "  " })
  ).rejects.toThrow("Content is unavailable");
  expect(api.post).toHaveBeenCalledOnce();
  expect(vi.mocked(api.post).mock.lastCall?.[1]?.data).toEqual({
    targetType: "ip",
    targetId: "ip",
    reason: "other",
    description: undefined,
  });
});
