// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WithdrawalsPanel, withdrawalMoney } from "./withdrawals-panel";
const id = "11111111-1111-4111-8111-111111111111";
const row = {
  id,
  userId: "creator",
  currency: "USD",
  amountMinor: "1500",
  status: "pending",
  version: 1,
  recipientLabel: "Fixture ••••1234",
  processingAdminId: null,
  paymentReference: null,
  resolutionReason: null,
  createdAt: "2026-10-05T01:00:00Z",
  paidAt: null,
};
const details = {
  ...row,
  earnings: [
    { id: "earning", title: "Task one", crewName: "Crew one", withdrawalAmountMinor: "1500" },
  ],
  events: [],
};
const bank = {
  fullName: "Fixture",
  accountNumber: "bank-1234",
  address: "Test address",
  swift: "DBSSSGSG",
  branchAddress: "Test branch",
};
const ok = (data: unknown) => new Response(JSON.stringify({ code: 200, data }));
const fetcher = vi.fn();
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  fetcher.mockImplementation((url: string) => {
    if (url.endsWith("/overview"))
      return Promise.resolve(
        ok([
          {
            currency: "USD",
            paidAmountMinor: "0",
            pendingAmountMinor: "1500",
            paidThisMonthAmountMinor: "0",
            availableAmountMinor: "1500",
          },
        ])
      );
    if (url.includes("?")) return Promise.resolve(ok({ items: [row], total: 1, pageSize: 50 }));
    if (url.endsWith("/recipient")) return Promise.resolve(ok({ recipient: bank }));
    if (url.endsWith("/decision"))
      return Promise.resolve(ok({ id, status: "processing", version: 2 }));
    return Promise.resolve(ok(details));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((e) => e.textContent === label)!;
async function render() {
  await act(async () => root.render(<WithdrawalsPanel adminId="finance" />));
}
async function click(label: string) {
  await act(async () => button(label).click());
}
it("shows exact monetary totals and task detail without disclosing bank details automatically", async () => {
  await render();
  expect(host.textContent).toContain("Awaiting payment");
  expect(host.textContent).toContain("USD 15.00");
  await click("View");
  expect(host.textContent).toContain("Task one");
  expect(host.textContent).not.toContain(bank.accountNumber);
  expect(fetcher.mock.calls.some(([u]) => String(u).endsWith("/recipient"))).toBe(false);
  await click("View bank details");
  expect(host.textContent).toContain(bank.accountNumber);
  await click("Close details");
  expect(host.textContent).not.toContain(bank.accountNumber);
});
it("submits processing once and uses the selected request version", async () => {
  await render();
  await click("View");
  let resolve!: (value: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      })
  );
  await click("Start processing");
  expect(button("Start processing").disabled).toBe(true);
  await click("Start processing");
  const calls = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/decision"));
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body)).toEqual({ action: "process", expectedVersion: 1 });
  await act(async () => resolve(ok({ id, status: "processing", version: 2 })));
  expect(host.textContent).not.toContain("Task one");
});
it("prevents another administrator from marking an already claimed request paid", async () => {
  await render();
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(
      ok({ ...details, status: "processing", processingAdminId: "other-finance", version: 2 })
    )
  );
  await click("View");
  expect(host.textContent).toContain("another administrator");
  expect(button("Mark as paid")).toBeUndefined();
});
it("keeps amounts exact beyond JavaScript safe integers", () => {
  expect(withdrawalMoney("900719925474099312", "USD")).toBe("USD 9,007,199,254,740,993.12");
});
it("shows a failed payment response inside the open confirmation without reporting success", async () => {
  await render();
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(
      ok({ ...details, status: "processing", processingAdminId: "finance", version: 2 })
    )
  );
  await click("View");
  const input = host.querySelector<HTMLInputElement>('[aria-label="Transfer reference"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "BANK-REF"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Mark as paid");
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(JSON.stringify({ message: "Withdrawal changed. Refresh before continuing." }), {
        status: 409,
      })
    )
  );
  await click("Confirm paid");
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Withdrawal changed. Refresh before continuing.");
  expect(button("Confirm paid").disabled).toBe(false);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/decision"))).toHaveLength(1);
});
it("requires privileged handover confirmation and preserves conflicts in the dialog", async () => {
  await act(async () => root.render(<WithdrawalsPanel adminId="finance" canTakeOver />));
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(
      ok({ ...details, status: "processing", processingAdminId: "other-finance", version: 2 })
    )
  );
  await click("View");
  expect(button("Take over").disabled).toBe(true);
  const input = host.querySelector<HTMLInputElement>('[aria-label="Handover reason"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Operator unavailable"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Take over");
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/decision"))).toHaveLength(0);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("transfer records");
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(JSON.stringify({ message: "Withdrawal changed. Refresh before continuing." }), {
        status: 409,
      })
    )
  );
  await click("Reviewed transfers — take over");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Withdrawal changed");
  const calls = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/decision"));
  expect(JSON.parse(calls[0][1].body)).toEqual({
    action: "takeover",
    expectedVersion: 2,
    reason: "Operator unavailable",
    transferHistoryReviewed: true,
  });
});
