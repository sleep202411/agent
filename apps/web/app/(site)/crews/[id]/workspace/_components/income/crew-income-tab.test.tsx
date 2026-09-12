/* eslint-disable no-restricted-syntax -- Native select is a test double for the themed Select primitives. */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CrewIncomeTab } from "./crew-income-tab";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  account: "alice",
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
  useCrewEarnings: () => ({ data: [], refetch: vi.fn() }),
  useCrewPayouts: () => ({ data: [], refetch: vi.fn() }),
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
async function render(crewId = "crew") {
  await act(async () =>
    root.render(
      <CrewIncomeTab
        crewId={crewId}
        crewName="Crew"
        members={[{ id: "member", userId: "user", status: "active" }] as never[]}
        canViewCrewLedger
        canCreateEarning
        canApproveEarning
        canReverseEarning
        canCreatePayout
        canManagePayout
      />
    )
  );
}
function button(text: string) {
  return Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text)!;
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
