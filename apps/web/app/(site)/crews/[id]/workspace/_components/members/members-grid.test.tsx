import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MembersGrid } from "./members-grid";
import type { CrewMemberDTO } from "@repo/shared/crew";
const state = vi.hoisted(() => ({
  account: "alice",
  remove: vi.fn(),
  transfer: vi.fn(),
  revoke: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string, args?: { name?: string }) =>
    args?.name ? `${key}:${args.name}` : key,
}));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  useUserDisplays: () => new Map(),
  displayNameOf: (id: string) => id,
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("./crew-agreements-dialog", () => ({ CrewAgreementsDialog: () => null }));
vi.mock("./member-card", () => ({
  MemberCard: ({
    member,
    onAskRemove,
    onAskTransfer,
  }: {
    member: CrewMemberDTO;
    onAskRemove: (id: string, name: string) => void;
    onAskTransfer: (id: string, name: string) => void;
  }) => (
    <div>
      <button onClick={() => onAskRemove(member.id, member.id)}>remove:{member.id}</button>
      <button onClick={() => onAskTransfer(member.userId, member.id)}>transfer:{member.id}</button>
    </div>
  ),
}));
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
vi.mock("@/components/ui/schema-field/switch-control", () => ({
  SwitchControl: ({
    value,
    onChange,
    disabled,
  }: {
    value: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      checked={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  CrewApiError: class extends Error {},
  useRemoveMember: () => ({ mutate: state.remove, isPending: false }),
  useTransferCrewOwner: () => ({ mutate: state.transfer, isPending: false }),
  useRevokeCrewInvitation: () => ({
    mutateAsync: state.revoke,
    mutate: (id: string, h: { onSuccess: () => void; onError: (e: unknown) => void }) =>
      void state.revoke(id).then(h.onSuccess, h.onError),
    isPending: false,
  }),
  useCrewInvitations: () => ({
    data: [
      {
        id: "invite",
        inviteeUserId: "recipient",
        expiresAt: "2026-10-01T00:00:00Z",
        policyKeys: [],
      },
    ],
    total: 1,
    isLoading: false,
    isError: false,
    hasNextPage: false,
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const members = ["A", "B"].map(
  (id) => ({ id, userId: id, isOwner: false, joinedAt: "2026-09-12T00:00:00Z" }) as CrewMemberDTO
);
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  state.account = "alice";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function render(crewId = "crew") {
  await act(async () =>
    root.render(
      <MembersGrid
        crewId={crewId}
        members={members}
        canInvite
        canManageMembers
        canManagePermissions
        canTransferOwnership
        canManageAgreements
        loading={false}
        onInvite={() => {}}
      />
    )
  );
}
function button(text: string) {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function confirm() {
  await act(async () => {
    const b = button("confirm");
    b.click();
    b.click();
  });
}
it.each(["remove", "transfer"])(
  "prevents duplicate %s requests and retains failed confirmation for retry",
  async (kind) => {
    await render();
    await click(`${kind}:A`);
    if (kind === "transfer")
      await act(async () =>
        host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
      );
    await confirm();
    const fn = kind === "remove" ? state.remove : state.transfer;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]?.[0]).toEqual(
      kind === "remove" ? "A" : { toUserId: "A", removeOldOwner: true }
    );
    const h = fn.mock.calls[0]?.[1];
    await act(async () => {
      h.onError(new Error("Specific failure"));
      h.onSettled?.();
    });
    expect(state.error).toHaveBeenCalledWith("Specific failure");
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    await confirm();
    expect(fn).toHaveBeenCalledTimes(2);
  }
);
it.each(["account", "crew", "target", "unmount"])(
  "ignores old member decisions after %s changes",
  async (change) => {
    await render();
    await click(change === "target" ? "transfer:A" : "remove:A");
    await confirm();
    const old = (change === "target" ? state.transfer : state.remove).mock.calls[0]?.[1];
    if (change === "account") state.account = "bob";
    if (change === "unmount") await act(async () => root.render(null));
    await render(change === "crew" ? "next" : "crew");
    if (change !== "target") expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    await click("transfer:B");
    await confirm();
    await act(async () => {
      old.onSuccess();
      old.onError(new Error("Old failure"));
      old.onSettled?.();
    });
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "transferOwnerConfirm:B"
    );
    await confirm();
    expect(state.transfer).toHaveBeenCalledTimes(change === "target" ? 2 : 1);
  }
);
it("blocks duplicate revocations and ignores success after account switching", async () => {
  let resolve!: (v: unknown) => void;
  state.revoke.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  await render();
  await act(async () => {
    const b = button("revokeInvitation");
    b.click();
    b.click();
  });
  expect(state.revoke).toHaveBeenCalledTimes(1);
  state.account = "bob";
  await render();
  await act(async () => resolve({}));
  expect(state.success).not.toHaveBeenCalled();
});
