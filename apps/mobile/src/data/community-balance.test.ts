import { expect, it, vi } from "vitest";
import { fetchCommunityPointBalance } from "./ip-api";
import { api } from "@/lib/api-client";
vi.mock("@/config", () => ({ appEnv: {}, resolveAssetUrl: (value: string) => value }));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/lib/api-client", () => ({
  api: { get: vi.fn() },
  ApiRequestError: class extends Error {},
}));
it("reads only spendable community points without losing integer precision", async () => {
  vi.mocked(api.get).mockResolvedValue({
    accounts: [
      { currency: "community_point", balanceKind: "withdrawable", availableBalance: "9" },
      {
        currency: "community_point",
        balanceKind: "consumable",
        availableBalance: "9007199254740993",
      },
    ],
  });
  expect(await fetchCommunityPointBalance()).toBe("9007199254740993");
});
it("reports a verified empty wallet as zero", async () => {
  vi.mocked(api.get).mockResolvedValue({ accounts: [] });
  expect(await fetchCommunityPointBalance()).toBe("0");
});
it.each([
  null,
  {},
  { accounts: {} },
  { accounts: [null] },
  ...[undefined, "oops", "1.5", -2].map((availableBalance) => ({
    accounts: [{ currency: "community_point", balanceKind: "consumable", availableBalance }],
  })),
])("keeps an unreadable wallet unknown: %j", async (response) => {
  vi.mocked(api.get).mockResolvedValue(response);
  expect(await fetchCommunityPointBalance()).toBeNull();
});
it("does not turn a failed request into a zero balance", async () => {
  vi.mocked(api.get).mockRejectedValueOnce(new Error("offline"));
  expect(await fetchCommunityPointBalance()).toBeNull();
});
