// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CrewMemberDTO } from "@repo/shared/crew";
import type { LookupUserDTO } from "@repo/shared/users";
import { MemberCard } from "./member-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => ({ user: { id: "alice" } }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/src/lib/user-id-codec", () => ({ encodeUserId: (id: string) => `encoded-${id}` }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, vars?: Record<string, string | number>) => {
    const copy: Record<string, string> = {
      memberRoleOwner: "Owner",
      memberOwnerAccess: "Full workspace access",
      memberFinanceAccess: "Member + finance access",
      memberStandardAccess: "Standard member access",
      memberOwnerProtected: "Protected owner",
      memberViewProfile: "Profile",
      memberFinanceBadge: "Finance",
      memberAdminBadge: "Administrator",
      memberAccessPresetStandard: "Standard member",
      memberAccessPresetFinance: "Finance",
      memberAccessPresetAdmin: "Administrator",
      memberAccessPresetAdminFinance: "Administrator + finance",
      addMemberAccessLabel: "Access preset",
      memberJoinedAgo: `Joined ${vars?.date ?? ""}`,
      memberViaOwnershipTransfer: "via ownership transfer",
      justNow: "just now",
      daysAgo: `${vars?.count ?? 0} days ago`,
      transferOwner: "Transfer ownership",
      removeMember: "Remove",
    };
    return copy[key] ?? key;
  },
}));
vi.mock("@/components/user-avatar", () => ({
  UserAvatar: ({ src, name, seed }: { src?: string | null; name?: string; seed?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element -- test stub
    <img data-user-avatar="" data-src={src ?? ""} data-seed={seed ?? ""} alt={name ?? ""} />
  ),
}));
vi.mock("@/app/(site)/crews/_hooks/use-position-label", () => ({
  useTranslatePositionValue: () => (role: string) => role,
}));
vi.mock("@/app/(site)/crews/_hooks/use-users", () => ({
  displayNameOf: (userId: string, displays: Map<string, LookupUserDTO>) =>
    displays.get(userId)?.nickname ?? `User ${userId}`,
}));
vi.mock("@/app/(site)/crews/_hooks/use-crew", () => ({
  CrewApiError: class CrewApiError extends Error {},
  useUpdateMember: () => ({ mutate: vi.fn(), isPending: false }),
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderMember(member: CrewMemberDTO, display: LookupUserDTO, canManage = false) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <MemberCard
        crewId="crew-1"
        member={member}
        displays={new Map([[display.userId, display]])}
        canManage={canManage}
        canManagePermissions={canManage}
        canTransferOwnership={canManage}
        onAskRemove={vi.fn()}
        onAskTransfer={vi.fn()}
      />
    )
  );
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("MemberCard", () => {
  it("uses the shared avatar and treats a transferred owner as the owner", () => {
    renderMember(
      {
        id: "member-1",
        crewId: "crew-1",
        userId: "7",
        status: "active",
        joinedVia: "ownership_transfer",
        isOwner: true,
        positions: [],
        policyKeys: [],
        joinedAt: new Date().toISOString(),
        removedAt: null,
        version: 1,
      },
      {
        userId: "7",
        nickname: "Isaac",
        avatar: "avatars/isaac.png",
        isCrewMember: true,
        isCrewOwner: true,
      }
    );

    const avatar = document.querySelector<HTMLImageElement>("img[data-user-avatar]");
    expect(avatar?.dataset.src).toBe("avatars/isaac.png");
    expect(avatar?.dataset.seed).toBe("7");
    expect(document.body.textContent).toContain("Isaac");
    expect(document.body.textContent).toContain("Owner");
    expect(document.body.textContent).toContain("Full workspace access");
    expect(document.querySelector('button[aria-label="Remove"]')).toBeNull();
  });

  it("represents combined atomic policies as one access preset", () => {
    renderMember(
      {
        id: "member-2",
        crewId: "crew-1",
        userId: "8",
        status: "active",
        joinedVia: "invitation",
        isOwner: false,
        positions: [],
        policyKeys: ["finance", "admin"],
        joinedAt: new Date().toISOString(),
        removedAt: null,
        version: 1,
      },
      {
        userId: "8",
        nickname: "Ari",
        avatar: null,
        isCrewMember: true,
        isCrewOwner: false,
      },
      true
    );

    const accessSelect = document.querySelector<HTMLElement>('[role="combobox"]');
    expect(accessSelect?.textContent).toContain("Administrator + finance");
    expect(accessSelect?.getAttribute("aria-label")).toBe("Access preset");
  });
});
