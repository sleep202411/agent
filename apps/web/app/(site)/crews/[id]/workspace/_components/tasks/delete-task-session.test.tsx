import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DeleteTaskButton } from "./delete-task-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({
  account: "alice",
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/app/(site)/crews/_hooks/use-tasks", () => ({
  useDeleteCrewTask: () => ({ mutateAsync: state.remove, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const container = document.createElement("div");
document.body.appendChild(container);
let root = createRoot(container);
const onDeleted = vi.fn();
async function render(id = "task", crewId = "crew") {
  await act(async () =>
    root.render(<DeleteTaskButton task={{ id, crewId, version: 7 }} onDeleted={onDeleted} />)
  );
}
async function open() {
  await act(async () => container.querySelector("button")!.click());
}
function confirm() {
  return Array.from(container.querySelectorAll('[role="dialog"] button')).find(
    (b) => b.textContent === "label"
  ) as HTMLButtonElement;
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
it("blocks duplicate deletion and permits retry after failure", async () => {
  const pending = deferred();
  state.remove.mockReturnValueOnce(pending.promise).mockResolvedValue(undefined);
  await render();
  await open();
  await act(async () => {
    confirm().click();
    confirm().click();
  });
  expect(state.remove).toHaveBeenCalledTimes(1);
  await act(async () => pending.reject(new Error("retry deletion")));
  expect(state.error).toHaveBeenCalledWith("retry deletion");
  expect(confirm().disabled).toBe(false);
  await act(async () => confirm().click());
  expect(onDeleted).toHaveBeenCalledTimes(1);
});
it.each(["account", "task", "crew", "unmount"])(
  "ignores a successful deletion after %s changes",
  async (change) => {
    const pending = deferred();
    state.remove.mockReturnValue(pending.promise);
    await render();
    await open();
    await act(async () => confirm().click());
    if (change === "account") state.account = "bob";
    if (change === "unmount") await act(async () => root.render(null));
    else {
      await render(change === "task" ? "other" : "task", change === "crew" ? "other" : "crew");
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      await open();
    }
    await act(async () => pending.resolve());
    expect(onDeleted).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    if (change !== "unmount") expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  }
);
it("suppresses deletion errors after leaving", async () => {
  const pending = deferred();
  state.remove.mockReturnValue(pending.promise);
  await render();
  await open();
  await act(async () => confirm().click());
  await act(async () => root.render(null));
  await act(async () => pending.reject(new Error("old failure")));
  expect(state.error).not.toHaveBeenCalled();
});
