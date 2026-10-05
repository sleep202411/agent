import { expect, it, vi } from "vitest";
import { recordWithdrawalBatch, type BatchWithdrawal, type BatchResult } from "./withdrawal-batch";
const row = (id: string): BatchWithdrawal => ({
  id,
  userId: `creator-${id}`,
  amountMinor: "1234",
  currency: "USD",
  recipientLabel: `Creator ${id}`,
  status: "pending",
  processingAdminId: null,
});
const current = (id: string) => ({
  ...row(id),
  version: 1,
  paymentReference: null,
  paidAdminId: null,
});
const options = () => ({
  rows: [row("a"), row("b")],
  references: { a: "BANK-A", b: "BANK-B" },
  adminId: "finance",
  signal: new AbortController().signal,
  onResult: vi.fn<(id: string, result: BatchResult) => void>(),
});
it("validates all references before claiming or paying any request", async () => {
  const api = vi.fn();
  await expect(
    recordWithdrawalBatch({ ...options(), references: { a: "BANK-A" }, api })
  ).rejects.toThrow("every withdrawal");
  expect(api).not.toHaveBeenCalled();
});
it("uses each authoritative version, continues after a claim conflict, and reports partial results", async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(current("a"))
    .mockRejectedValueOnce(new Error("Already claimed"))
    .mockResolvedValueOnce({
      ...current("b"),
      version: 4,
      status: "processing",
      processingAdminId: "finance",
    })
    .mockResolvedValueOnce({ version: 5 });
  const input = options();
  await recordWithdrawalBatch({ ...input, api });
  expect(input.onResult.mock.calls).toEqual([
    ["a", { status: "failed", message: "Already claimed" }],
    ["b", { status: "paid" }],
  ]);
  expect(api.mock.calls[1][2]).toEqual({ action: "process", expectedVersion: 1 });
  expect(api.mock.calls[3][2]).toEqual({
    action: "pay",
    expectedVersion: 4,
    paymentReference: "BANK-B",
  });
});
it("reconciles a successful payment with a lost response without paying it again", async () => {
  const api = vi.fn().mockResolvedValueOnce({
    ...current("a"),
    status: "paid",
    paymentReference: "BANK-A",
    paidAdminId: "finance",
  });
  const input = { ...options(), rows: [row("a")] };
  await recordWithdrawalBatch({ ...input, api });
  expect(api).toHaveBeenCalledTimes(1);
  expect(input.onResult).toHaveBeenCalledWith("a", { status: "paid" });
});
it.each([
  { status: "paid", paymentReference: "DIFFERENT", paidAdminId: "finance" },
  { status: "paid", paymentReference: "BANK-A", paidAdminId: "other" },
  { status: "processing", processingAdminId: "other" },
  { status: "rejected" },
  { amountMinor: "9999" },
])("does not write when current ownership, payment or amount differs: %j", async (change) => {
  const api = vi.fn().mockResolvedValue({ ...current("a"), ...change });
  const input = { ...options(), rows: [row("a")] };
  await recordWithdrawalBatch({ ...input, api });
  expect(api).toHaveBeenCalledTimes(1);
  expect(input.onResult).toHaveBeenCalledWith("a", expect.objectContaining({ status: "failed" }));
});
it("stops after abort even when an in-flight claim returned successfully", async () => {
  const controller = new AbortController();
  const api = vi
    .fn()
    .mockResolvedValueOnce(current("a"))
    .mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve({ version: 2 });
    });
  await expect(
    recordWithdrawalBatch({ ...options(), signal: controller.signal, api })
  ).rejects.toThrow();
  expect(api).toHaveBeenCalledTimes(2);
});
it("claims a pending request before recording the completed transfer", async () => {
  const api = vi
    .fn()
    .mockResolvedValueOnce(current("a"))
    .mockResolvedValueOnce({ version: 2 })
    .mockResolvedValueOnce({ version: 3 });
  await recordWithdrawalBatch({ ...options(), rows: [row("a")], api });
  expect(api.mock.calls[2][2]).toEqual({
    action: "pay",
    expectedVersion: 2,
    paymentReference: "BANK-A",
  });
});
