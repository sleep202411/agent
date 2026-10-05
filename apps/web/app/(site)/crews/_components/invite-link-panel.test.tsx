import { act, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InviteLinkPanel } from "./invite-link-panel";
const mocks = vi.hoisted(() => ({
  userId: "alice" as string | null,
  error: null as Error | null,
  fetching: false,
  refetch: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  links: [] as Array<{
    id: string;
    kind: string;
    maxUses: null;
    useCount: number;
    expiresAt: null;
  }>,
}));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: mocks.userId ? { id: mocks.userId } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-invite-links", () => ({
  useCreateCrewInviteLink: () => ({ mutateAsync: mocks.create }),
  useCrewInviteLinks: () => ({
    data: mocks.links,
    isError: !!mocks.error,
    error: mocks.error,
    isFetching: mocks.fetching,
    refetch: mocks.refetch,
  }),
  useRevokeCrewInviteLink: () => ({ mutateAsync: mocks.revoke }),
  crewInviteUrl: (token: string) => `https://example.test/${token}`,
}));
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Box,
    DialogHeader: Box,
    DialogTitle: Box,
    DialogBody: Box,
  };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it.each(["reopen", "crew", "account"] as const)(
  "ignores the prior link after %s",
  async (change) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const pending: Array<(value: { token: string }) => void> = [];
    mocks.create.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    let open = true;
    let crewId = "original";
    const render = () =>
      act(() =>
        root.render(
          <StrictMode>
            <InviteLinkPanel crewId={crewId} open={open} canGrantPolicies={false} />
          </StrictMode>
        )
      );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    try {
      render();
      act(() => {
        const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
          button.textContent?.includes("inviteLinkCreate")
        )!;
        button.click();
        button.click();
      });
      expect(mocks.create).toHaveBeenCalledTimes(1);
      if (change === "reopen") {
        open = false;
        render();
        open = true;
      }
      if (change === "crew") crewId = "later";
      if (change === "account") mocks.userId = "bob";
      render();
      act(() =>
        [...host.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent?.includes("inviteLinkCreate"))!
          .click()
      );
      expect(mocks.create).toHaveBeenCalledTimes(2);
      await act(async () => pending[1]!({ token: "new-link" }));
      expect(host.querySelector("input")?.value).toContain("new-link");
      await act(async () => pending[0]!({ token: "old-link" }));
      expect(host.querySelector("input")?.value).toContain("new-link");
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      mocks.userId = "alice";
      vi.resetAllMocks();
    }
  }
);

it("identifies and revokes community links from the management list", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  mocks.links = ["member", "community"].map((kind) => ({
    id: kind,
    kind,
    maxUses: null,
    useCount: 0,
    expiresAt: null,
  }));
  mocks.revoke.mockResolvedValue(undefined);
  try {
    act(() => root.render(<InviteLinkPanel crewId="crew" open canGrantPolicies={false} />));
    expect(host.textContent).toContain("inviteLinkKindMember");
    expect(host.textContent).toContain("inviteLinkKindCommunity");
    await act(async () =>
      host.querySelectorAll<HTMLButtonElement>('button[aria-label="inviteLinkRevoke"]')[1]!.click()
    );
    expect(mocks.revoke).toHaveBeenCalledWith("community");
  } finally {
    act(() => root.unmount());
    mocks.links = [];
    vi.resetAllMocks();
  }
});

it.each(["same", "other", "failed"])("handles %s link revocation after creation", async (kind) => {
  const host = document.createElement("div");
  const root = createRoot(host);
  mocks.links = [
    {
      id: kind === "other" ? "other" : "new",
      kind: "member",
      maxUses: null,
      useCount: 0,
      expiresAt: null,
    },
  ];
  mocks.create.mockResolvedValue({ id: "new", token: "new-token" });
  if (kind === "failed") mocks.revoke.mockRejectedValue(new Error("Unavailable"));
  else mocks.revoke.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  try {
    act(() => root.render(<InviteLinkPanel crewId="crew" open canGrantPolicies={false} />));
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((b) => b.textContent?.includes("inviteLinkCreate"))!
        .click()
    );
    expect(host.querySelector("input")?.value).toContain("new-token");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('button[aria-label="inviteLinkRevoke"]')!.click()
    );
    if (kind === "same") {
      expect(host.querySelector('button[aria-label="inviteLinkCopy"]')).toBeNull();
      expect(host.querySelector("input")).toBeNull();
    } else expect(host.querySelector("input")?.value).toContain("new-token");
  } finally {
    act(() => root.unmount());
    mocks.links = [];
    vi.resetAllMocks();
  }
});

it("recovers a failed link list in place without losing a freshly created token", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  mocks.create.mockResolvedValue({ id: "new", token: "new-token" });
  mocks.error = new Error("Invite list unavailable");
  const render = () =>
    act(() => root.render(<InviteLinkPanel crewId="crew" open canGrantPolicies={false} />));
  const button = (label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === label
    )!;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  try {
    render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Invite list unavailable");
    expect(host.textContent).not.toContain("inviteLinkNone");
    await act(async () => button("inviteLinkCreate").click());
    await act(async () => button("retry").click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
    mocks.fetching = true;
    render();
    expect(button("retry").disabled).toBe(true);
    expect(host.querySelector("input")?.value).toContain("new-token");
    mocks.fetching = false;
    mocks.error = null;
    mocks.links = [{ id: "new", kind: "member", maxUses: null, useCount: 0, expiresAt: null }];
    render();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('button[aria-label="inviteLinkRevoke"]')).not.toBeNull();
    expect(host.querySelector("input")?.value).toContain("new-token");
  } finally {
    act(() => root.unmount());
    mocks.error = null;
    mocks.fetching = false;
    mocks.links = [];
    vi.resetAllMocks();
  }
});

it("creates a task-bound single-use link and clears it when the reviewed task changes", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  mocks.userId = "alice";
  mocks.links = [];
  mocks.create.mockResolvedValue({ id: "task-link", token: "task-token" });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  let version = 3;
  const render = () =>
    act(() =>
      root.render(
        <InviteLinkPanel
          crewId="crew"
          open
          canGrantPolicies
          task={{ id: "task", version, title: "Animate scene" }}
        />
      )
    );
  try {
    render();
    expect(host.textContent).toContain("taskInviteIntro");
    expect(host.textContent).not.toContain("addMemberAccessLabel");
    expect(host.textContent).not.toContain("inviteLinkUsesLabel");
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((item) => item.textContent?.includes("inviteLinkCreate"))!
        .click()
    );
    expect(mocks.create).toHaveBeenCalledWith({
      taskId: "task",
      taskVersion: 3,
      maxUses: 1,
      policyKeys: [],
    });
    expect(host.querySelector("input")?.value).toContain("task-token");
    version = 4;
    render();
    expect(host.querySelector("input")).toBeNull();
  } finally {
    act(() => root.unmount());
    vi.resetAllMocks();
  }
});
