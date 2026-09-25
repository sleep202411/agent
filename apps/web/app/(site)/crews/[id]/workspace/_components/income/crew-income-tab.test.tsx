/* eslint-disable no-restricted-syntax -- Native select is a test double for the themed Select primitives. */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CrewApiError } from "@/app/(site)/crews/_hooks/api";
import { CrewIncomeTab } from "./crew-income-tab";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  account: "alice",
  failure: null as Error | null,
  failed: false,
  summary: undefined as unknown,
  pageFailed: false,
  fetching: false,
  refetch: vi.fn(),
  nextPage: vi.fn(),
  earning: false,
  payout: false,
  posted: false,
  create: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  ...Object.fromEntries(
    [
      "useApproveCrewEarning",
      "useCreateCrewEarning",
      "useCreateCrewPayout",
      "usePayCrewPayout",
      "useRejectCrewEarning",
      "useReverseCrewEarning",
      "useVoidCrewPayout",
    ].map((name) => [name, () => ({ mutateAsync: state.create, isPending: false })])
  ),
  useCrewEarnings: () => ({
    summary: state.summary,
    data: state.earning
      ? [
          {
            id: "earning",
            version: 1,
            userId: "user",
            title: "Recorded bonus",
            status: state.posted ? "posted" : "pending",
            currency: "USD",
            amountMinor: "1000",
            sourceType: "milestone_bonus",
            createdAt: "2026-09-01T00:00:00Z",
          },
        ]
      : [],
    refetch: state.refetch,
    fetchNextPage: state.nextPage,
    hasNextPage: true,
    isError: state.failed,
    isFetchNextPageError: state.pageFailed,
    isFetching: state.fetching,
    error: state.failure ?? new Error("Ledger unavailable"),
  }),
  useCrewPayouts: () => ({
    summary: state.summary,
    data: state.payout
      ? [
          {
            id: "payout",
            version: 1,
            userId: "user",
            status: "pending",
            currency: "USD",
            amountMinor: "1000",
            netAmountMinor: "1000",
            withholdingAmountMinor: "0",
            createdAt: "2026-09-01T00:00:00Z",
          },
        ]
      : [],
    refetch: state.refetch,
    fetchNextPage: state.nextPage,
    hasNextPage: true,
    isError: state.failed,
    isFetchNextPageError: state.pageFailed,
    isFetching: state.fetching,
    error: state.failure ?? new Error("Ledger unavailable"),
  }),
  useCrewEarningDetail: () => ({}),
  useCrewPayoutDetail: () => ({}),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  ...Object.fromEntries(
    [
      "DialogBody",
      "DialogContent",
      "DialogDescription",
      "DialogFooter",
      "DialogHeader",
      "DialogTitle",
    ].map((name) => [name, ({ children }: { children: ReactNode }) => <div>{children}</div>])
  ),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (s: string) => void;
    children: ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
const container = document.createElement("div");
document.body.appendChild(container);
let root = createRoot(container);
async function render(crewId = "crew", canApprove = true) {
  await act(async () =>
    root.render(
      <CrewIncomeTab
        crewId={crewId}
        crewName="Crew"
        members={[{ id: "member", userId: "user", status: "active" }] as never[]}
        canViewCrewLedger
        canCreateEarning
        canApproveEarning={canApprove}
        canReverseEarning
        canCreatePayout
        canManagePayout
      />
    )
  );
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text
  )!;
}
async function fill(placeholder: string, text: string) {
  await act(async () => {
    const input = container.querySelector(`input[placeholder="${placeholder}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function prepare() {
  await render();
  await act(async () => button("create.action").click());
  await fill("create.titlePlaceholder", "Bonus");
  await fill("0", "10");
  await act(async () => {
    const select = container.querySelector('[role="dialog"] select')!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      select,
      "member"
    );
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function deferred() {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
  state.account = "alice";
  state.failed = false;
  state.summary = undefined;
  state.failure = null;
  state.pageFailed = false;
  state.fetching = false;
  state.earning = false;
  state.payout = false;
  state.posted = false;
});
it.each(["account", "crew"])("resets income dialogs and drafts on %s change", async (change) => {
  await prepare();
  if (change === "account") state.account = "bob";
  await render(change === "crew" ? "other" : "crew");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button("create.action").click());
  expect(
    (container.querySelector('input[placeholder="create.titlePlaceholder"]') as HTMLInputElement)
      .value
  ).toBe("");
});
it("does not close a reopened income dialog after an older creation completes", async () => {
  const pending = deferred();
  state.create.mockReturnValue(pending.promise);
  await prepare();
  await act(async () => button("create.submit").click());
  expect(state.create).toHaveBeenCalledTimes(1);
  await act(async () => button("actions.cancel").click());
  await act(async () => button("create.action").click());
  await fill("create.titlePlaceholder", "New draft");
  await act(async () => pending.resolve());
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    (container.querySelector('input[placeholder="create.titlePlaceholder"]') as HTMLInputElement)
      .value
  ).toBe("New draft");
  expect(state.success).not.toHaveBeenCalled();
});
it("suppresses income errors after leaving", async () => {
  const pending = deferred();
  state.create.mockReturnValue(pending.promise);
  await prepare();
  await act(async () => button("create.submit").click());
  expect(state.create).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => pending.reject(new Error("old failure")));
  expect(state.error).not.toHaveBeenCalled();
});

async function preparePayout() {
  await render();
  await act(async () => button("views.payouts").click());
  await act(async () => button("payout.create.action").click());
  await act(async () => {
    const dialog = container.querySelector('[role="dialog"]')!;
    const select = dialog.querySelector("select")!;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(
      select,
      "member"
    );
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const input = dialog.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "10");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(["earning", "payout"])(
  "guards duplicate %s creation and retries unchanged inputs with the same key",
  async (kind) => {
    const pending = deferred();
    state.create.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    if (kind === "earning") await prepare();
    else await preparePayout();
    const submit = kind === "earning" ? "create.submit" : "payout.create.submit";
    await act(async () => {
      button(submit).click();
      button(submit).click();
    });
    expect(state.create).toHaveBeenCalledTimes(1);
    const original = state.create.mock.calls[0]![0].idempotencyKey;
    expect(container.querySelector('[role="dialog"] input')!.matches(":disabled")).toBe(true);
    await act(async () => pending.reject(new Error("response lost")));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => button(submit).click());
    expect(state.create.mock.calls[1]![0].idempotencyKey).toBe(original);
  }
);
it("uses a new creation key after the earning inputs change", async () => {
  state.create.mockRejectedValueOnce(new Error("try again")).mockResolvedValue(undefined);
  await prepare();
  await act(async () => button("create.submit").click());
  const original = state.create.mock.calls[0]![0].idempotencyKey;
  await fill("create.titlePlaceholder", "Changed bonus");
  await act(async () => button("create.submit").click());
  expect(state.create.mock.calls[1]![0].idempotencyKey).not.toBe(original);
});

it.each(["reject", "reverse", "pay", "void"])(
  "prevents duplicate %s decisions and retains failed input",
  async (action) => {
    const pending = deferred();
    state.create.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
    state.earning = action === "reject" || action === "reverse";
    state.posted = action === "reverse";
    state.payout = !state.earning;
    await render();
    if (state.payout) await act(async () => button("views.payouts").click());
    if (action === "pay") await act(async () => button("payout.actions.pay").click());
    else {
      const label = state.payout ? "payout.actions.void" : `actions.${action}`;
      await act(async () =>
        (container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click()
      );
    }
    const dialog = container.querySelector('[role="dialog"]')!;
    const field = dialog.querySelector(action === "pay" ? "input" : "textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        action === "pay" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        "value"
      )!.set!.call(field, "Confirmed reason");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit =
      action === "reject"
        ? "actions.confirmReject"
        : action === "reverse"
          ? "actions.confirmReverse"
          : `payout.dialog.${action}.submit`;
    await act(async () => {
      button(submit).click();
      button(submit).click();
    });
    expect(state.create).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("decision failed")));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => button(submit).click());
    expect(state.create).toHaveBeenCalledTimes(2);
  }
);
it("guards rapid repeated earnings approval", async () => {
  state.earning = true;
  const pending = deferred();
  state.create.mockReturnValue(pending.promise);
  await render();
  const approve = container.querySelector('[aria-label="actions.approve"]') as HTMLButtonElement;
  await act(async () => {
    approve.click();
    approve.click();
  });
  expect(state.create).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve());
});

it.each(["earnings", "payouts"])(
  "retains %s records after a failed page and retries that page",
  async (view) => {
    state.earning = view === "earnings";
    state.payout = view === "payouts";
    await render();
    if (state.payout) await act(async () => button("views.payouts").click());
    state.failed = true;
    state.pageFailed = true;
    await render();
    expect(container.textContent).toContain(state.payout ? "payout.record" : "Recorded bonus");
    expect(container.textContent).toContain("Ledger unavailable");
    await act(async () => button("retry").click());
    expect(state.nextPage).toHaveBeenCalledTimes(1);
    expect(state.refetch).not.toHaveBeenCalled();
  }
);
it("retains earnings after refresh errors and waits for refresh before pagination", async () => {
  state.earning = true;
  state.fetching = true;
  await render();
  expect(button("loadMore").disabled).toBe(true);
  state.fetching = false;
  state.failed = true;
  await render();
  expect(container.textContent).toContain("Recorded bonus");
  await act(async () => button("retry").click());
  expect(state.refetch).toHaveBeenCalledTimes(1);
  expect(state.nextPage).not.toHaveBeenCalled();
});

it.each(["earnings", "payouts"])(
  "restarts rejected %s pagination without discarding visible records",
  async (view) => {
    state.earning = view === "earnings";
    state.payout = view === "payouts";
    await render();
    if (state.payout) await act(async () => button("views.payouts").click());
    state.failed = true;
    state.pageFailed = true;
    state.failure = new CrewApiError(400, {
      code: state.payout ? "CREW_PAYOUT_CURSOR_INVALID" : "CREW_EARNING_CURSOR_INVALID",
    });
    await render();
    expect(container.textContent).toContain(state.payout ? "payout.record" : "Recorded bonus");
    await act(async () => button("retry").click());
    expect(state.refetch).toHaveBeenCalledTimes(1);
    expect(state.nextPage).not.toHaveBeenCalled();
  }
);

vi.mock("@/app/(site)/crews/_components/amendment-finance-panel", () => ({
  AmendmentFinancePanel: () => <div>finance-amendment-panel</div>,
}));

it("shows the amendment queue only for earnings approvers", async () => {
  await render("crew", true);
  expect(container.textContent).toContain("finance-amendment-panel");
  await render("crew", false);
  expect(container.textContent).not.toContain("finance-amendment-panel");
});

function metric(label: string) {
  return [...container.querySelectorAll("p")].find((p) => p.textContent === label)?.parentElement?.textContent ?? "";
}
function summary(value: unknown) {
  return { byStatus: { posted: { amountMinor: value }, pending: { amountMinor: value } },
    postedThisMonthAmountMinor: value, availableAmountMinor: value, reservedAmountMinor: value, paidAmountMinor: value };
}
it.each(["earnings", "payouts"])("does not fabricate zero %s totals before a snapshot exists", async (view) => {
  await render(); if (view === "payouts") await act(async () => button("views.payouts").click());
  expect(container.textContent?.match(/metrics.unavailable/g)).toHaveLength(3);
});
it.each(["earnings", "payouts"])("hides failed %s totals and restores genuine zero after recovery", async (view) => {
  state.summary = summary("12345"); await render();
  if (view === "payouts") await act(async () => button("views.payouts").click());
  const label = view === "payouts" ? "metrics.availableAmount" : "metrics.confirmedAmount";
  expect(metric(label)).toContain("123.45");
  state.failed = true; await render();
  expect(metric(label)).toContain("metrics.unavailable"); expect(metric(label)).not.toContain("123.45");
  state.failed = false; state.summary = summary("0"); await render();
  expect(metric(label)).toContain("0.00"); expect(metric(label)).not.toContain("metrics.unavailable");
});
it.each([null, "", "1.5", "oops", 100])("handles malformed monetary summary %s without crashing or reporting zero", async (value) => {
  state.summary = summary(value); await render();
  expect(container.textContent?.match(/metrics.unavailable/g)).toHaveLength(3);
  await act(async () => button("views.payouts").click());
  expect(container.textContent?.match(/metrics.unavailable/g)).toHaveLength(3);
});
it("handles incomplete earning summary groups", async () => {
  state.summary = { byStatus: {} }; await render();
  expect(container.textContent?.match(/metrics.unavailable/g)).toHaveLength(3);
});
it("preserves exact large and negative payout totals", async () => {
  state.summary = { availableAmountMinor: "-123", reservedAmountMinor: "0", paidAmountMinor: "9007199254740993123" };
  await render(); await act(async () => button("views.payouts").click());
  expect(metric("metrics.availableAmount")).toContain("-1.23");
  expect(metric("metrics.reservedAmount")).toContain("0.00");
  expect(metric("metrics.paidAmount")).toContain("90,071,992,547,409,931.23");
});
