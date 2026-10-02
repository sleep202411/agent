import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemberCard } from "./member-card";
import type { CrewMemberDTO } from "@repo/shared/crew";
const state = vi.hoisted(() => ({
  account: "alice",
  update: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  remove: vi.fn(),
  transfer: vi.fn(),
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: { id: state.account } }),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/app/(site)/crews/_hooks/use-position-label", () => ({
  useTranslatePositionValue: () => (key: string) => key,
}));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({ displayNameOf: () => "Member" }));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("sonner", () => ({ toast: { success: state.success, error: state.error } }));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  CrewApiError: class extends Error {},
  useUpdateMember: () => ({ mutate: state.update, isPending: false }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    onValueChange,
    disabled,
  }: {
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={() => onValueChange("finance")}>
      Change access
    </button>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: () => null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const member: CrewMemberDTO = {
  id: "member",
  crewId: "crew",
  userId: "12",
  isOwner: false,
  status: "active",
  positions: [],
  policyKeys: [],
  joinedVia: "invitation",
  joinedAt: "2026-09-12T00:00:00Z",
  removedAt: null,
  version: 4,
};
beforeEach(() => {
  vi.clearAllMocks();
  state.account = "alice";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function render(crewId = "crew", id = "member") {
  await act(async () =>
    root.render(
      <MemberCard
        crewId={crewId}
        member={{ ...member, id }}
        displays={new Map()}
        canManage
        canManagePermissions
        canTransferOwnership
        onAskRemove={state.remove}
        onAskTransfer={state.transfer}
      />
    )
  );
}
async function change() {
  await act(async () => {
    const b = [...host.querySelectorAll("button")].find((b) => b.textContent === "Change access")!;
    b.click();
    b.click();
  });
}
it("serializes permission changes, blocks other member actions and allows retry", async () => {
  await render();
  await change();
  expect(state.update).toHaveBeenCalledTimes(1);
  expect(state.update.mock.calls[0]?.[0]).toEqual({
    memberId: "member",
    input: { policyKeys: ["finance"], expectedVersion: 4 },
  });
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[aria-label="removeMember"]')!.click();
    host.querySelector<HTMLButtonElement>('[aria-label="transferOwner"]')!.click();
  });
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.transfer).not.toHaveBeenCalled();
  const h = state.update.mock.calls[0]?.[1];
  await act(async () => {
    h.onError(new Error("Specific error"));
    h.onSettled?.();
  });
  expect(state.error).toHaveBeenCalledWith("Specific error");
  await change();
  expect(state.update).toHaveBeenCalledTimes(2);
});
it.each(["account", "crew", "member", "unmount"])(
  "ignores permission results after %s changes",
  async (changeKind) => {
    await render();
    await change();
    const h = state.update.mock.calls[0]?.[1];
    if (changeKind === "account") state.account = "bob";
    if (changeKind === "unmount") await act(async () => root.render(null));
    await render(
      changeKind === "crew" ? "next-crew" : "crew",
      changeKind === "member" ? "next-member" : "member"
    );
    await change();
    await act(async () => {
      h.onSuccess({});
      h.onError(new Error("Old error"));
      h.onSettled?.();
    });
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).not.toHaveBeenCalled();
    await change();
    expect(state.update).toHaveBeenCalledTimes(2);
  }
);
