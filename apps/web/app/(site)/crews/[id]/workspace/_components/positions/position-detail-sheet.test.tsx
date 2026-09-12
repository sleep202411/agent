import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PositionDetailSheet } from "./position-detail-sheet";
import type { CrewPositionDTO } from "@repo/shared/crew";
const state = vi.hoisted(() => ({
  account: "alice",
  update: vi.fn(),
  remove: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-position-label", () => ({
  useTranslatePositionValue: () => (key: string) => key,
}));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/app/(site)/crews/_components/create-crew-job-dialog", () => ({
  CreateCrewJobDialog: () => <div data-editor>Editor</div>,
}));
vi.mock("@/components/ui/sheet", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    SheetBody: Part,
    SheetContent: Part,
    SheetFooter: Part,
    SheetHeader: Part,
    SheetTitle: Part,
  };
});
vi.mock("@/components/ui/alert-dialog", () => {
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  const Action = ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
  return {
    AlertDialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="alertdialog">{children}</div> : null,
    AlertDialogContent: Part,
    AlertDialogHeader: Part,
    AlertDialogTitle: Part,
    AlertDialogDescription: Part,
    AlertDialogFooter: Part,
    AlertDialogAction: Action,
    AlertDialogCancel: Action,
  };
});

vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  CrewApiError: class extends Error {},
  CURRENCY_SYMBOLS: { USD: "$" },
  ZERO_DECIMAL_CURRENCIES: new Set(),
  useUpdatePosition: () => ({ mutate: state.update, isPending: false }),
  useDeletePosition: () => ({ mutate: state.remove, isPending: false }),
  useApproveApplication: () => ({ mutate: state.approve, isPending: false }),
  useRejectApplication: () => ({ mutate: state.reject, isPending: false }),
  useCrewApplications: () => ({
    data: [],
    summary: { total: 0, pending: 0, approved: 0, rejected: 0 },
    isLoading: false,
    isError: false,
    hasNextPage: false,
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const position = {
  id: "position",
  positionType: "director",
  description: "Description",
  status: "open",
  targetCount: 2,
  recruitedCount: 0,
  requiredSkills: [],
  workMode: "remote",
  location: null,
  employmentType: "project_based",
  experienceLevel: "any",
  salary: { negotiable: true },
  closeDate: null,
  durationMonths: null,
  revenueSharePercent: null,
} as unknown as CrewPositionDTO;
beforeEach(() => {
  vi.clearAllMocks();
  state.account = "alice";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function render(p: CrewPositionDTO | null = position, crewId = "crew") {
  await act(async () =>
    root.render(
      <PositionDetailSheet crewId={crewId} position={p} canManage onOpenChange={state.close} />
    )
  );
}
function button(text: string, scope: ParentNode = host) {
  return [...scope.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function confirm(kind = "freeze") {
  await act(async () => {
    const dialog = host.querySelector('[role="alertdialog"]')!;
    const b = button(kind === "delete" ? "delete" : "confirm", dialog);
    b.click();
    b.click();
  });
}
it.each(["freeze", "delete"])(
  "prevents overlapping %s requests and preserves failure retry",
  async (kind) => {
    await render();
    await click(kind === "freeze" ? "closeJob" : "delete");
    await confirm(kind);
    const fn = kind === "freeze" ? state.update : state.remove;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(button("editJobAction").disabled).toBe(true);
    const h = fn.mock.calls[0]?.[1];
    await act(async () => {
      h.onError(new Error("Specific failure"));
      h.onSettled?.();
    });
    expect(state.error).toHaveBeenCalledWith("Specific failure");
    await confirm(kind);
    expect(fn).toHaveBeenCalledTimes(2);
  }
);
it("serializes rapid unfreeze clicks", async () => {
  await render({ ...position, status: "frozen" });
  await act(async () => {
    const b = button("unfreezeJob");
    b.click();
    b.click();
    button("delete").click();
  });
  expect(state.update).toHaveBeenCalledTimes(1);
  expect(state.update.mock.calls[0]?.[0]).toEqual({ positionId: "position", status: "open" });
  expect(host.querySelector('[role="alertdialog"]')).toBeNull();
});
it.each(["account", "crew", "position", "close"])(
  "drops late deletion results after %s changes",
  async (change) => {
    await render();
    await click("delete");
    await confirm("delete");
    const old = state.remove.mock.calls[0]?.[1];
    if (change === "account") state.account = "bob";
    if (change === "close") await render(null);
    await render(
      change === "position" ? { ...position, id: "next" } : position,
      change === "crew" ? "next-crew" : "crew"
    );
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    await click("closeJob");
    await confirm();
    await act(async () => {
      old.onSuccess({});
      old.onError(new Error("Old error"));
      old.onSettled?.();
    });
    expect(state.close).not.toHaveBeenCalled();
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).not.toHaveBeenCalled();
    await confirm();
    expect(state.update).toHaveBeenCalledTimes(1);
  }
);
it("resets the nested editor when the position changes", async () => {
  await render();
  await click("editJobAction");
  expect(host.querySelector("[data-editor]")).not.toBeNull();
  await render({ ...position, id: "next" });
  expect(host.querySelector("[data-editor]")).toBeNull();
});
