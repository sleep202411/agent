import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AmendmentFinance } from "./amendment-finance";
const h = vi.hoisted(() => ({
  generation: 1,
  access: vi.fn(),
  queue: vi.fn(),
  settle: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./amendment-finance-api", () => ({
  fetchAmendmentAccess: h.access,
  fetchAmendments: h.queue,
  settleAmendment: h.settle,
}));
vi.mock("./crew-finance-api", () => ({
  formatFinanceMoney: (value: string, currency: string) => `${currency} ${value}`,
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ background: "black" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
const id = "00000000-0000-4000-8000-000000000001";
const row = {
  id,
  applicationId: "application",
  taskId: id,
  proposedByUserId: "producer",
  applicantId: "creator",
  proposal: {
    id,
    expectedVersion: 2,
    expectedTaskVersion: 3,
    scope: "Revised shots",
    feeAmount: "12345",
    currency: "USD",
    feePeriod: "project",
    revenueShareBp: 250,
    shareBasis: "Net receipts",
    reason: "Additional approved shots",
  },
  status: "awaiting_settlement",
  confirmedAt: "2026-09-30T00:00:00Z",
  settledByUserId: null,
  settledAt: null,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const click = async (name: string) => {
  await act(async () => button(name).click());
};
const render = async () => {
  await act(async () =>
    root.render(
      <AmendmentFinance crewId="crew" userId="finance" generation={1} onClose={h.close} />
    )
  );
};
const review = async () => {
  await render();
  await click("crewAmendmentFinance.title");
  await click("crewAmendmentFinance.review");
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.access.mockResolvedValue(true);
  h.queue.mockResolvedValue({ items: [row], nextCursor: null });
  h.settle.mockResolvedValue({
    ...row,
    status: "effective",
    settledAt: "2026-09-30T01:00:00Z",
    settledByUserId: "finance",
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("does not load the queue without approval permission", async () => {
  h.access.mockResolvedValue(false);
  await render();
  expect(button("crewAmendmentFinance.title")).toBeUndefined();
  expect(h.queue).not.toHaveBeenCalled();
});
it("rechecks access before opening", async () => {
  await render();
  h.access.mockResolvedValue(false);
  await click("crewAmendmentFinance.title");
  expect(host.textContent).toContain("permission is required");
  expect(h.queue).not.toHaveBeenCalled();
});
it("requires explicit review and confirmation", async () => {
  await review();
  expect(h.settle).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Revised shots");
  expect(host.textContent).toContain("2.50%");
  expect(host.textContent).toContain("crewAmendmentFinance.confirmation");
  await click("crewAmendmentFinance.apply");
  expect(h.settle).toHaveBeenCalledWith(row, 1);
  expect(host.textContent).toContain("crewAmendmentFinance.effectiveResult");
  expect(button("crewAmendmentFinance.retry")).toBeUndefined();
});
it("locks navigation and admits only one pending settlement", async () => {
  let resolve!: (value: unknown) => void;
  h.settle.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await review();
  await act(async () => {
    button("crewAmendmentFinance.apply").click();
    button("crewAmendmentFinance.apply").click();
  });
  expect(h.settle).toHaveBeenCalledTimes(1);
  expect(button("thread.refresh").disabled).toBe(true);
  expect(button("crewExpenses.back").disabled).toBe(true);
  expect(button("crewAmendments.status.settlement_requested").disabled).toBe(true);
  await act(async () => resolve({ ...row, status: "effective" }));
  expect(button("crewExpenses.back").disabled).toBe(false);
});
it("retries the same correction and clears the previous error", async () => {
  h.settle.mockRejectedValueOnce(new Error("Network unavailable"));
  await review();
  await click("crewAmendmentFinance.apply");
  expect(host.textContent).toContain("Network unavailable");
  await click("crewAmendmentFinance.retry");
  expect(h.settle.mock.calls[0]).toEqual(h.settle.mock.calls[1]);
  expect(host.textContent).not.toContain("Network unavailable");
});
it.each([403, 409])("requires new review after HTTP %s", async (status) => {
  h.settle.mockRejectedValue(Object.assign(new Error("State changed"), { status }));
  await review();
  await click("crewAmendmentFinance.apply");
  expect(button("crewAmendmentFinance.retry").disabled).toBe(true);
  await click("crewAmendmentFinance.cancel");
  expect(h.queue).toHaveBeenCalledTimes(2);
  expect(h.access).toHaveBeenCalledTimes(3);
});
it("distinguishes manual settlement", async () => {
  h.settle.mockResolvedValue({ ...row, status: "settlement_requested" });
  await review();
  await click("crewAmendmentFinance.apply");
  expect(host.textContent).toContain("crewAmendmentFinance.manualResult");
  expect(button("crewAmendmentFinance.retry")).toBeUndefined();
});
it("refreshes Finance when leaving", async () => {
  await review();
  await click("crewExpenses.back");
  expect(h.close).toHaveBeenCalledTimes(1);
});
it("ignores a late response after account change", async () => {
  let resolve!: (value: unknown) => void;
  h.queue.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await render();
  await click("crewAmendmentFinance.title");
  h.generation = 2;
  await act(async () => resolve({ items: [row], nextCursor: null }));
  expect(host.textContent).not.toContain("Revised shots");
});
it("clears rows on paging permission loss", async () => {
  h.queue.mockResolvedValue({ items: [row], nextCursor: id });
  await render();
  await click("crewAmendmentFinance.title");
  h.access.mockResolvedValue(false);
  await click("crewAmendmentFinance.more");
  expect(host.textContent).not.toContain("Revised shots");
  expect(h.queue).toHaveBeenCalledTimes(1);
});
it("does not start a queue request after membership resolves for an old account", async () => {
  await render();
  let resolve!: (value: boolean) => void;
  h.access.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await click("crewAmendmentFinance.title");
  h.generation = 2;
  await act(async () => resolve(true));
  expect(h.queue).not.toHaveBeenCalled();
});
