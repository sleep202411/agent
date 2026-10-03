import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  listCreditCampaigns,
  claimCreditCampaign,
  redeemCreditVoucher,
} from "./credit-rewards-api";
import { creditRewardCommands } from "./credit-rewards-commands";
const state = vi.hoisted(() => ({ generation: 1 }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => state.generation }));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock("@/lib/durable-record", () => ({ durableRecord: vi.fn() }));
const id = "00000000-0000-4000-8000-000000000001";
const granted = {
  grantType: "compute_credits",
  currency: "compute_point",
  amount: "9007199254740993",
  workspaceId: id,
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  state.generation = 1;
});
it("reads current account campaigns and rejects malformed responses", async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({});
  const s = signal();
  expect(await listCreditCampaigns(1, s)).toEqual([]);
  expect(api.get).toHaveBeenCalledWith(
    "/billing/campaigns/active",
    expect.objectContaining({ signal: s, cache: "no-store", service: "aurora" })
  );
  await expect(listCreditCampaigns(1, s)).rejects.toThrow();
});
it("redeems the exact trimmed code and preserves integer precision", async () => {
  vi.mocked(api.post).mockResolvedValue({ granted, alreadyRedeemed: false });
  expect((await redeemCreditVoucher("  Gift-ABC ", 1, signal())).granted.amount).toBe(
    "9007199254740993"
  );
  expect(api.post).toHaveBeenCalledWith(
    "/billing/vouchers/redeem",
    expect.objectContaining({ data: { code: "Gift-ABC" }, retry: false })
  );
});
it("blocks cancelled, invalid and foreign-account writes before dispatch", async () => {
  const c = new AbortController();
  c.abort();
  await expect(claimCreditCampaign(id, 1, c.signal)).rejects.toThrow();
  await expect(redeemCreditVoucher("x", 1, signal())).rejects.toThrow();
  state.generation = 2;
  await expect(claimCreditCampaign(id, 1, signal())).rejects.toThrow();
  expect(api.post).not.toHaveBeenCalled();
});
it("rejects results arriving after account replacement", async () => {
  vi.mocked(api.post).mockImplementation(async () => {
    state.generation = 2;
    return { granted, alreadyClaimed: false };
  });
  await expect(claimCreditCampaign(id, 1, signal())).rejects.toThrow("session expired");
});
it.each(["campaign", "voucher"] as const)(
  "retains an uncertain %s request across reopening and clears only after confirmation",
  async (kind) => {
    let value: string | null = null;
    const storage = {
      read: () => value,
      write: (next: string) => {
        value = next;
      },
    };
    const command = kind === "campaign" ? { kind, id } : { kind, code: "GIFT" };
    const receipt =
      kind === "campaign" ? { granted, alreadyClaimed: true } : { granted, alreadyRedeemed: true };
    vi.mocked(api.post)
      .mockRejectedValueOnce(Error("Response lost"))
      .mockResolvedValueOnce(receipt);
    await expect(
      creditRewardCommands("alice", 1, storage).submit(command, signal())
    ).rejects.toThrow("Response lost");
    const reopened = creditRewardCommands("alice", 1, storage);
    expect(reopened.read()).toEqual(command);
    await expect(reopened.submit({ kind: "voucher", code: "OTHER" }, signal())).rejects.toThrow(
      "pending"
    );
    await reopened.submit(reopened.read()!, signal());
    expect(reopened.read()).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(2);
  }
);
it("never dispatches without a saved checkpoint", async () => {
  const storage = {
    read: () => null,
    write: () => {
      throw Error("Storage unavailable");
    },
  };
  await expect(
    creditRewardCommands("alice", 1, storage).submit({ kind: "campaign", id }, signal())
  ).rejects.toThrow("Storage unavailable");
  expect(api.post).not.toHaveBeenCalled();
});
it("serializes taps and keeps pending recovery after cancellation", async () => {
  let value: string | null = null,
    finish!: (v: unknown) => void;
  const storage = {
    read: () => value,
    write: (v: string) => {
      value = v;
    },
  };
  vi.mocked(api.post).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const commands = creditRewardCommands("alice", 1, storage),
    controller = new AbortController(),
    command = { kind: "campaign" as const, id };
  const request = commands.submit(command, controller.signal);
  await expect(commands.submit(command, signal())).rejects.toThrow("running");
  controller.abort();
  finish({ granted, alreadyClaimed: false });
  await expect(request).rejects.toThrow();
  expect(commands.read()).toEqual(command);
});
