import { act, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { CommunityInviteDialog } from "./community-invite-dialog";
const mocks = vi.hoisted(() => ({
  userId: "alice" as string | null,
  create: vi.fn(),
  qr: vi.fn(),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: mocks.qr } }));
beforeEach(() => {
  mocks.qr.mockResolvedValue("data:image/png;base64,cXJjb2Rl");
});
vi.mock("@/src/hooks/use-user", () => ({
  useCurrentUser: () => ({ user: mocks.userId ? { id: mocks.userId } : null }),
}));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(site)/crews/_hooks/use-invite-links", () => ({
  useCreateCrewInviteLink: () => ({ mutateAsync: mocks.create }),
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
            <CommunityInviteDialog crewId={crewId} open={open} onOpenChange={vi.fn()} />
          </StrictMode>
        )
      );
    try {
      render();
      expect(mocks.create).toHaveBeenCalledTimes(1);
      if (change === "reopen") {
        open = false;
        render();
        open = true;
      }
      if (change === "crew") crewId = "later";
      if (change === "account") mocks.userId = "bob";
      render();
      expect(mocks.create).toHaveBeenCalledTimes(2);
      await act(async () => pending[1]!({ token: "new-link" }));
      expect(host.querySelector("input")?.value).toContain("new-link");
      await act(async () => pending[0]!({ token: "old-link" }));
      expect(host.querySelector("input")?.value).toContain("new-link");
    } finally {
      act(() => root.unmount());
      mocks.userId = "alice";
      vi.resetAllMocks();
    }
  }
);

it("encodes the issued link locally and offers its QR download", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  mocks.create.mockResolvedValue({ token: "issued-token" });
  try {
    await act(async () =>
      root.render(<CommunityInviteDialog crewId="crew" open onOpenChange={vi.fn()} />)
    );
    await vi.waitFor(() =>
      expect(mocks.qr).toHaveBeenCalledWith("https://example.test/issued-token", {
        width: 512,
        margin: 4,
        errorCorrectionLevel: "M",
      })
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("qrAlt");
    expect(host.querySelector("a[download]")?.getAttribute("href")).toBe(
      "data:image/png;base64,cXJjb2Rl"
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    vi.resetAllMocks();
  }
});

it("retries QR rendering without creating another invitation and keeps the copyable link", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  mocks.create.mockResolvedValue({ token: "issued-token" });
  mocks.qr.mockRejectedValueOnce(new Error("QR rendering failed"));
  try {
    await act(async () =>
      root.render(<CommunityInviteDialog crewId="crew" open onOpenChange={vi.fn()} />)
    );
    await vi.waitFor(() => expect(host.textContent).toContain("QR rendering failed"));
    expect(host.querySelector("input")?.value).toBe("https://example.test/issued-token");
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "retry"
    )!;
    await act(async () => retry.click());
    await vi.waitFor(() => expect(host.querySelector("img")).not.toBeNull());
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.qr).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    vi.resetAllMocks();
  }
});

it("ignores an older QR result after the Crew changes", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const pending: Array<(value: string) => void> = [];
  mocks.qr.mockImplementation(() => new Promise<string>((resolve) => pending.push(resolve)));
  mocks.create.mockResolvedValueOnce({ token: "first" }).mockResolvedValueOnce({ token: "second" });
  try {
    await act(async () =>
      root.render(<CommunityInviteDialog crewId="first" open onOpenChange={vi.fn()} />)
    );
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await act(async () =>
      root.render(<CommunityInviteDialog crewId="second" open onOpenChange={vi.fn()} />)
    );
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]!("data:image/png;base64,bmV3"));
    await act(async () => pending[0]!("data:image/png;base64,b2xk"));
    expect(host.querySelector("a[download]")?.getAttribute("href")).toBe(
      "data:image/png;base64,bmV3"
    );
  } finally {
    act(() => root.unmount());
    vi.resetAllMocks();
  }
});
