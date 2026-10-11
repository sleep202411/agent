import { beforeEach, expect, it, vi } from "vitest";
import { fetchComputeWalletBalance } from "./compute-wallet";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ api: { get } }));
beforeEach(() => {
  get.mockReset();
});

it.each([
  {},
  { accounts: null },
  { accounts: [{ status: "active" }] },
  { accounts: [{ status: "active", availableBalance: "invalid" }] },
  { accounts: [{ status: "active", availableBalance: "-1" }] },
  { accounts: [{ status: "active", availableBalance: 9007199254740992 }] },
  { accounts: [{ availableBalance: "42" }] },
  { accounts: [{ status: "active", availableBalance: "10" }, { status: "active" }] },
])("does not present an unreadable ledger as zero or a partial total: %j", async (data) => {
  get.mockResolvedValue(data);
  await expect(fetchComputeWalletBalance()).rejects.toThrow("invalid wallet ledger");
});

it("preserves an explicitly empty ledger and an actual zero balance", async () => {
  get.mockResolvedValueOnce({ accounts: [] });
  await expect(fetchComputeWalletBalance()).resolves.toBe("0");
  get.mockResolvedValueOnce({ accounts: [{ status: "active", availableBalance: "0" }] });
  await expect(fetchComputeWalletBalance()).resolves.toBe("0");
});

it("sums integer strings exactly without including inactive accounts", async () => {
  get.mockResolvedValue({
    accounts: [
      { status: "active", availableBalance: "9007199254740993" },
      { status: "active", availableBalance: "7" },
      { status: "frozen", availableBalance: "100" },
    ],
  });
  await expect(fetchComputeWalletBalance()).resolves.toBe("9007199254741000");
});

it("keeps API errors unavailable and forwards cancellation", async () => {
  const controller = new AbortController();
  get.mockRejectedValue(new Error("offline"));
  await expect(fetchComputeWalletBalance(controller.signal)).rejects.toThrow("offline");
  expect(get).toHaveBeenCalledWith(
    "/billing/wallet-ledger",
    expect.objectContaining({ signal: controller.signal, cache: "no-store" })
  );
});
