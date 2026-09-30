import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewFinanceDetail } from "./crew-finance-detail";
import type { FinanceRow } from "./crew-finance-api";
vi.mock("./earning-decision", () => ({ EarningDecision: () => <span>earning actions</span> }));
vi.mock("./payout-decision", () => ({ PayoutDecision: () => <span>payout actions</span> }));
const h = vi.hoisted(() => ({ generation: 1, detail: vi.fn(), open: vi.fn(), close: vi.fn() }));
vi.mock("./crew-finance-detail-api", async (original) => ({
  ...(await original<typeof import("./crew-finance-detail-api")>()),
  fetchFinanceDetail: h.detail,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: vi.fn() } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const row: FinanceRow = {
  id: "record",
  userId: "user",
  currency: "USD",
  amountMinor: "100",
  createdAt: "2026-09-29T00:00:00Z",
  status: "posted",
  title: "Reward",
  description: null,
};
const earning = {
  ...row,
  sourceType: "task_reward",
  task: null,
  agreement: null,
  rejectionReason: "Needs evidence",
  reversalReason: null,
  events: [
    { id: "event", actorUserId: "manager", action: "earning.rejected", createdAt: row.createdAt },
  ],
};
const render = () =>
  act(async () =>
    root.render(
      <CrewFinanceDetail
        crewId="crew"
        userId="user"
        onChanged={h.close}
        view="earnings"
        selected={row}
        generation={1}
        onClose={h.close}
      />
    )
  );
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.detail.mockResolvedValue(earning);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("renders reasons and translated audit actions", async () => {
  await render();
  expect(host.textContent).toContain("Needs evidence");
  expect(host.textContent).toContain("crewFinance.eventRejected");
  expect(host.textContent).toContain("manager");
});
it("hides stale financial details when refresh loses permission", async () => {
  await render();
  h.detail.mockRejectedValue(new Error("Forbidden"));
  await act(async () => button("thread.refresh").click());
  expect(host.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("Needs evidence");
});
it("ignores responses from an expired account session", async () => {
  let resolve!: (v: unknown) => void;
  h.detail.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => resolve(earning));
  expect(host.textContent).not.toContain("Needs evidence");
  await render();
  expect(host.textContent).toBe("");
});
it("shows allocations and opens payment proof only on an explicit tap", async () => {
  h.detail.mockResolvedValue({
    ...row,
    netAmountMinor: "80",
    withholdingAmountMinor: "20",
    note: "Invoice",
    paymentMethod: "bank_transfer",
    paymentReference: "wire123",
    paymentProofUrl: "https://example.com/proof",
    voidReason: null,
    allocations: [
      { id: "allocation", amountMinor: "100", earning: { title: "Allocated reward", task: null } },
    ],
    events: [],
  });
  h.open.mockResolvedValue(undefined);
  await render();
  expect(host.textContent).toContain("Allocated reward");
  expect(host.textContent).toContain("USD 0.80");
  expect(h.open).not.toHaveBeenCalled();
  await act(async () => button("crewFinance.proof").click());
  expect(h.open).toHaveBeenCalledWith("https://example.com/proof");
});

vi.mock("./task-detail", () => ({
  TaskDetail: ({
    crewId,
    taskId,
    userId,
    onClose,
    onOpenWeb,
    closeLabel,
  }: {
    crewId: string;
    taskId: string;
    userId: string;
    onClose: () => void;
    onOpenWeb: (id: string) => void;
    closeLabel: string;
  }) => (
    <div>
      native task {crewId}:{taskId}:{userId}
      <button onClick={onClose}>{closeLabel}</button>
      <button onClick={() => onOpenWeb(taskId)}>open task web</button>
    </div>
  ),
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web {path}</div>,
}));
const task = { id: "11111111-1111-4111-8111-111111111111", number: 7, title: "Storyboard" };
const taskButton = "crewFinance.task 7 · Storyboard · crewFinance.openTask";
it("opens the native earning task and reloads financial details on return", async () => {
  h.detail.mockResolvedValue({ ...earning, task });
  await render();
  await act(async () => button(taskButton).click());
  expect(host.textContent).toContain(`native task crew:${task.id}:user`);
  h.detail.mockResolvedValue({ ...earning, task, amountMinor: "200" });
  await act(async () => button("crewFinance.backToRecord").click());
  expect(h.detail).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("USD 2.00");
  expect(host.textContent).not.toContain("native task");
});
it("rechecks finance permission on returning from a linked task", async () => {
  h.detail.mockResolvedValue({ ...earning, task });
  await render();
  await act(async () => button(taskButton).click());
  h.detail.mockRejectedValue(new Error("Forbidden"));
  await act(async () => button("crewFinance.backToRecord").click());
  expect(host.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("Needs evidence");
  expect(button(taskButton)).toBeUndefined();
});
it("opens a payout allocation task without opening external URLs", async () => {
  h.detail.mockResolvedValue({
    ...row,
    netAmountMinor: "80",
    withholdingAmountMinor: "20",
    note: null,
    paymentMethod: null,
    paymentReference: null,
    paymentProofUrl: null,
    voidReason: null,
    allocations: [{ id: "allocation", amountMinor: "100", earning: { title: "Reward", task } }],
    events: [],
  });
  await render();
  await act(async () => button(taskButton).click());
  expect(host.textContent).toContain(`native task crew:${task.id}:user`);
  expect(h.open).not.toHaveBeenCalled();
});
it("keeps the existing explicit Web option and returns to the same native task", async () => {
  h.detail.mockResolvedValue({ ...earning, task });
  await render();
  await act(async () => button(taskButton).click());
  await act(async () => button("open task web").click());
  expect(host.textContent).toContain(`/crews/crew/workspace?tab=tasks&task=${task.id}`);
  await act(async () => button("taskRelations.backToTask").click());
  expect(host.textContent).toContain(`native task crew:${task.id}:user`);
});
it("does not navigate linked tasks from an expired account", async () => {
  h.detail.mockResolvedValue({ ...earning, task });
  await render();
  h.generation = 2;
  await act(async () => button(taskButton).click());
  expect(host.textContent).not.toContain("native task");
});

vi.mock("./agreement-detail", () => ({
  AgreementDetail: ({
    agreementId,
    memberUserId,
    onClose,
  }: {
    agreementId: string;
    memberUserId: string;
    onClose: () => void;
  }) => (
    <div>
      native agreement {agreementId}:{memberUserId}
      <button onClick={onClose}>agreement back</button>
    </div>
  ),
}));
it("opens the linked agreement for the earning recipient and refreshes on return", async () => {
  const agreement = { id: "22222222-2222-4222-8222-222222222222", status: "sent" };
  h.detail.mockResolvedValue({ ...earning, agreement });
  await render();
  await act(async () =>
    button(`crewFinance.agreement · ${agreement.id} · agreementDetail.open`).click()
  );
  expect(host.textContent).toContain(`native agreement ${agreement.id}:user`);
  await act(async () => button("agreement back").click());
  expect(h.detail).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain("native agreement");
});
