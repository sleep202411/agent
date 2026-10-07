// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WithdrawalsPanel, withdrawalMoney, withdrawalAmountFilter } from "./withdrawals-panel";
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
    if (url.endsWith("/proofs")) return Promise.resolve(ok({ id: "proof-id" }));
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
  expect(button("Mark as paid").disabled).toBe(true);
  await selectProof(host.querySelector<HTMLInputElement>("#withdrawal-proof")!);
  await click("Mark as paid");
  fetcher.mockImplementationOnce(() => Promise.resolve(ok({ id: "proof-id" })));
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

it("applies date, search and exact minor-unit amount filters together", async () => {
  await render();
  for (const [label, value] of [
    ["Name or withdrawal ID", "Fixture"],
    ["From (UTC)", "2026-10-01"],
    ["Through (UTC)", "2026-10-06"],
    ["Minimum amount", "0.29"],
    ["Maximum amount", "15.00"],
  ]) {
    const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  await click("Search");
  const url = String(fetcher.mock.calls.filter(([url]) => String(url).includes("?")).at(-1)![0]);
  const params = new URL(url, "https://fixture.invalid").searchParams;
  expect(Object.fromEntries(params)).toMatchObject({
    q: "Fixture",
    from: "2026-10-01",
    to: "2026-10-06",
    minAmountMinor: "29",
    maxAmountMinor: "1500",
    currency: "USD",
    page: "1",
  });
});
it("parses monetary filters exactly and rejects unsupported precision", () => {
  expect(withdrawalAmountFilter("0.29")).toBe("29");
  expect(withdrawalAmountFilter("90071992547409.93")).toBe("9007199254740993");
  expect(withdrawalAmountFilter(" ")).toBe("");
  for (const value of ["1.001", "-1", "1e3", "999999999999999999999"])
    expect(() => withdrawalAmountFilter(value)).toThrow();
});
it("downloads the applied-filter CSV and does not export unsaved filter edits", async () => {
  await render();
  const createObjectURL = vi.fn(() => "blob:withdrawals");
  const revokeObjectURL = vi.fn();
  const OriginalURL = URL;
  vi.stubGlobal(
    "URL",
    class extends OriginalURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
  );
  const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  try {
    const field = host.querySelector<HTMLInputElement>('[aria-label="Name or withdrawal ID"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        field,
        "not applied"
      );
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    fetcher.mockImplementationOnce(() =>
      Promise.resolve(ok({ csv: '"Amount"\r\n"15.00"\r\n', filename: "withdrawals.csv", count: 1 }))
    );
    await click("Export CSV");
    const url = String(fetcher.mock.calls.find(([url]) => String(url).includes("/export?"))![0]);
    expect(url).toContain("currency=USD");
    expect(url).not.toContain("not+applied");
    expect(url).not.toContain("page=");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchor).toHaveBeenCalledOnce();
  } finally {
    anchor.mockRestore();
  }
});

it("retains selected proof on upload failure, blocks payment, and reuses verified proof after a payment conflict", async () => {
  await render();
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(
      ok({ ...details, status: "processing", processingAdminId: "finance", version: 2 })
    )
  );
  await click("View");
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="Transfer reference"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "BANK-PROOF"
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const note = host.querySelector<HTMLTextAreaElement>("#withdrawal-payment-note")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      note,
      "Reconciled internally"
    );
    note.dispatchEvent(new Event("input", { bubbles: true }));
    const file = host.querySelector<HTMLInputElement>("#withdrawal-proof")!;
    Object.defineProperty(file, "files", {
      value: [new File(["%PDF-1.7\n%%EOF"], "proof.pdf", { type: "application/pdf" })],
    });
    file.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("Mark as paid");
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(
      new Response(JSON.stringify({ message: "Proof storage unavailable" }), { status: 503 })
    )
  );
  await click("Confirm paid");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Proof storage unavailable"
  );
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/decision"))).toHaveLength(0);
  fetcher.mockImplementationOnce(() => Promise.resolve(ok({ id: "proof-id" })));
  fetcher.mockImplementationOnce(() =>
    Promise.resolve(new Response(JSON.stringify({ message: "Payment conflict" }), { status: 409 }))
  );
  await click("Confirm paid");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Payment conflict");
  const uploads = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/proofs"));
  expect(uploads).toHaveLength(2);
  expect(uploads[0][1].body).toBeInstanceOf(FormData);
  expect(uploads[0][1].headers).toBeUndefined();
  await click("Confirm paid");
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/proofs"))).toHaveLength(2);
  const decisions = fetcher.mock.calls.filter(([url]) => String(url).endsWith("/decision"));
  expect(decisions).toHaveLength(2);
  expect(JSON.parse(decisions[1][1].body)).toEqual({
    action: "pay",
    expectedVersion: 2,
    paymentReference: "BANK-PROOF",
    paymentProofId: "proof-id",
    internalPaymentNote: "Reconciled internally",
  });
});

it("requires a reference and explicit confirmation before recording a selected batch", async () => {
  await render();
  expect(button("Record batch payments").disabled).toBe(true);
  await act(async () =>
    host.querySelector<HTMLInputElement>(`[aria-label="Select withdrawal ${id}"]`)!.click()
  );
  await click("Record batch payments (1)");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("does not send money");
  expect(button("Confirm paid").disabled).toBe(true);
  await act(async () => {
    const reference = dialog.querySelector<HTMLInputElement>(`[id="batch-reference-${id}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      reference,
      "BANK-BATCH"
    );
    reference.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button("Confirm paid").disabled).toBe(true);
  await act(async () => dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button("Confirm paid").disabled).toBe(true);
  await selectProof(dialog.querySelector<HTMLInputElement>(`[id="batch-proof-${id}"]`)!);
  await act(async () => dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Confirm paid");
  expect(dialog.textContent).toContain("1 of 1 payments recorded");
  expect(
    fetcher.mock.calls
      .filter(([url]) => String(url).endsWith("/decision"))
      .map(([, options]) => JSON.parse(options.body))
  ).toEqual([
    { action: "process", expectedVersion: 1 },
    {
      action: "pay",
      expectedVersion: 2,
      paymentReference: "BANK-BATCH",
      paymentProofId: "proof-id",
    },
  ]);
  await click("Done");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button("Record batch payments").disabled).toBe(true);
});

async function selectProof(input: HTMLInputElement) {
  await act(async () => {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["%PDF-1.7\n%%EOF"], "proof.pdf", { type: "application/pdf" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
