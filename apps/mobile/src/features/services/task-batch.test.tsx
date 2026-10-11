import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { TaskBatch } from "./task-batch";
const h = vi.hoisted(() => ({ generation: 1, tasks: vi.fn(), members: vi.fn(), submit: vi.fn() }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/crew-position-label", () => ({ crewPositionLabel: (role: string) => role }));
vi.mock("./crew-finance-api", () => ({
  formatFinanceMoney: (amount: string, currency: string) => `${currency} ${amount}`,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
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
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("./crew-members-api", () => ({ fetchCrewMemberPage: h.members }));
vi.mock("./task-batch-api", () => ({
  fetchBatchTasks: h.tasks,
  submitTaskBatch: h.submit,
  canBatchTask: (t: { isRecruiting: boolean }) => !t.isRecruiting,
}));
const task = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  number: 1,
  title: "Script",
  isRecruiting: false,
  rewardUsdMinor: 100,
  rewardCurrency: "CNY",
};
let host: HTMLDivElement, root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(key))!;
async function render() {
  await act(async () =>
    root.render(
      <TaskBatch crewId="crew" userId="user" generation={1} mode="assign" onClose={() => {}} />
    )
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.tasks.mockResolvedValue({ items: [task], nextCursor: null });
  h.members.mockResolvedValue({ items: [{ userId: "creator" }], nextCursor: null });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("prevents repeated batch submission until fresh state is loaded after a lost response", async () => {
  h.submit.mockRejectedValue(new Error("Response lost"));
  await render();
  await act(async () => button("TASK-1").click());
  await act(async () => button("creator").click());
  await act(async () => {
    button("mobileProduction.batchAssign").click();
    button("mobileProduction.batchAssign").click();
  });
  expect(h.submit).toHaveBeenCalledTimes(1);
  expect(button("mobileProduction.batchAssign").disabled).toBe(true);
  expect(host.textContent).toContain("mobileProduction.batchRetryHelp");
  h.tasks.mockResolvedValue({ items: [{ ...task, isRecruiting: true }], nextCursor: null });
  await act(async () => button("thread.refresh").click());
  expect(button("TASK-1").disabled).toBe(true);
});
it("shows authorization failures and keeps mutations disabled", async () => {
  h.tasks.mockRejectedValue(new Error("Task management permission is required"));
  await render();
  expect(host.textContent).toContain("Task management permission is required");
  expect(button("mobileProduction.batchAssign").disabled).toBe(true);
});
