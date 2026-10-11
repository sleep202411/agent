import { beforeEach, expect, it, vi } from "vitest";
import {
  fetchWithdrawalBalances,
  fetchWithdrawalHistory,
  fetchWithdrawalProof,
  fetchWithdrawalRecipient,
  requestWithdrawal,
  withdrawalPreview,
  type WithdrawalCommand,
} from "./withdrawal-api";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
const id = "00000000-0000-4000-8000-000000000001";
const recipient = {
  fullName: "Creator",
  accountNumber: "1234",
  address: "Address",
  swift: "DBSSSGSG",
  branchAddress: "Branch",
};
const command: WithdrawalCommand = {
  requestId: id,
  currency: "USD",
  expectedAvailableAmountMinor: "9223372036854775807",
  percentageBps: 3333,
  recipient,
};
const amount = String((BigInt(command.expectedAvailableAmountMinor) * 3333n) / 10000n);
const receipt = {
  id,
  currency: "USD",
  amountMinor: amount,
  percentageBps: 3333,
  status: "pending",
  createdAt: "2026-10-06T00:00:00Z",
};
const signal = () => new AbortController().signal;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
});
it("calculates exact floor-rounded amounts through the signed 64-bit limit", () => {
  expect(withdrawalPreview(command.expectedAvailableAmountMinor, "33.33")).toEqual({
    percentageBps: 3333,
    amountMinor: amount,
  });
  expect(withdrawalPreview("101", "50")).toEqual({ percentageBps: 5000, amountMinor: "50" });
  expect(withdrawalPreview("10000", "0.01")).toEqual({ percentageBps: 1, amountMinor: "1" });
});
it.each(["0", "100.01", "-5", "1e2", "NaN", "0.001", " 50", "50,1"])(
  "rejects invalid percentages %s",
  (value) => {
    expect(withdrawalPreview("10000", value)).toBeNull();
  }
);
it("rejects zero and unsupported balances and sub-cent requests", () => {
  expect(withdrawalPreview("9223372036854775808", "100")).toBeNull();
  expect(withdrawalPreview("0", "100")).toBeNull();
  expect(withdrawalPreview("1", "50")).toBeNull();
});
it("submits exactly the reviewed terms without automatic retries and validates returned amounts", async () => {
  h.post.mockResolvedValue(receipt);
  const abort = signal();
  await expect(requestWithdrawal(command, 1, abort)).resolves.toEqual(receipt);
  expect(h.post).toHaveBeenCalledWith("/me/withdrawals", {
    service: "aurora",
    retry: false,
    signal: abort,
    data: command,
  });
  h.post.mockResolvedValue({ ...receipt, amountMinor: "1" });
  await expect(requestWithdrawal(command, 1, signal())).rejects.toThrow("receipt mismatch");
});
it("rejects invalid recipient details before any write", async () => {
  await expect(
    requestWithdrawal({ ...command, recipient: { ...recipient, swift: "invalid" } }, 1, signal())
  ).rejects.toThrow();
  expect(h.post).not.toHaveBeenCalled();
});
it("checks cancellation and account generation both before and after a request", async () => {
  const c = new AbortController();
  c.abort();
  await expect(requestWithdrawal(command, 1, c.signal)).rejects.toThrow("expired");
  h.post.mockImplementation(async () => {
    h.generation = 2;
    return receipt;
  });
  await expect(requestWithdrawal(command, 1, signal())).rejects.toThrow("expired");
});
it("reads personal balances and saved recipient without administrative endpoints or user IDs", async () => {
  h.get
    .mockResolvedValueOnce([
      {
        currency: "USD",
        confirmedAmountMinor: "100",
        availableAmountMinor: "60",
        reservedAmountMinor: "40",
        paidAmountMinor: "0",
      },
    ])
    .mockResolvedValueOnce({ recipient });
  expect((await fetchWithdrawalBalances(1, signal()))[0]?.availableAmountMinor).toBe("60");
  expect(await fetchWithdrawalRecipient(1, signal())).toEqual(recipient);
  expect(h.get.mock.calls.map((call) => call[0])).toEqual([
    "/me/withdrawals/balances",
    "/me/withdrawals/recipient",
  ]);
});
it("validates history while stripping bank details and internal notes", async () => {
  h.get.mockResolvedValue({
    items: [
      {
        ...receipt,
        paidAt: null,
        resolutionReason: null,
        hasPaymentProof: false,
        recipient,
        internalNotes: "private",
      },
    ],
    nextCursor: id,
  });
  const page = await fetchWithdrawalHistory(1, null, signal());
  expect(page.items[0]).not.toHaveProperty("recipient");
  expect(page.items[0]).not.toHaveProperty("internalNotes");
  await fetchWithdrawalHistory(1, id, signal());
  expect(h.get).toHaveBeenLastCalledWith(
    "/me/withdrawals",
    expect.objectContaining({ params: { cursor: id }, cache: "no-store" })
  );
});
it("requests a fresh private proof and rejects unsafe or expired links", async () => {
  h.post.mockResolvedValue({
    url: "https://files.test/proof.pdf",
    expiresAt: "2099-10-06T00:00:00Z",
  });
  expect(await fetchWithdrawalProof(id, 1, signal())).toBe("https://files.test/proof.pdf");
  for (const url of [
    "javascript:alert(1)",
    "http://files.test/proof",
    "https://user:password@files.test/proof",
  ]) {
    h.post.mockResolvedValue({ url, expiresAt: "2099-10-06T00:00:00Z" });
    await expect(fetchWithdrawalProof(id, 1, signal())).rejects.toThrow();
  }
  h.post.mockResolvedValue({ url: "https://files.test/proof", expiresAt: "2000-01-01T00:00:00Z" });
  await expect(fetchWithdrawalProof(id, 1, signal())).rejects.toThrow("expired");
});
