import { act, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { InviteLinkPanel } from "./invite-link-panel";
const mocks = vi.hoisted(() => ({ userId: "alice" as string | null, create: vi.fn() }));
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: mocks.userId ? { id: mocks.userId } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-invite-links", () => ({
  useCreateCrewInviteLink: () => ({ mutateAsync: mocks.create }),
  useCrewInviteLinks: () => ({ data: [] }),
  useRevokeCrewInviteLink: () => ({ mutateAsync: vi.fn() }),
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
