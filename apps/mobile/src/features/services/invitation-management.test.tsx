import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { InvitationManagement } from "./invitation-management";
const h = vi.hoisted(() => ({ generation: 1, get: vi.fn(), post: vi.fn(), close: vi.fn() }));
vi.mock("./position-edit", () => ({
  PositionEdit: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Edit Form</button>
  ),
}));
vi.mock("./position-lifecycle", () => ({
  PositionLifecycle: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Lifecycle Form</button>
  ),
}));
vi.mock("./position-create", () => ({
  PositionCreate: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Create Position Form</button>
  ),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white", border: "gray" }) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
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
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({
    value,
    onChangeText,
    editable,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    editable: boolean;
    accessibilityLabel: string;
  }) => (
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));
const position = {
  id: "position",
  crewId: "crew",
  taskId: "00000000-0000-4000-8000-000000000001",
  positionType: "Custom Role",
  status: "open",
  targetCount: 2,
  recruitedCount: 0,
};
const row = {
  id: "00000000-0000-4000-8000-000000000002",
  positionId: "position",
  inviteeUserId: "creator",
  status: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
  applicationId: null,
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
const button = (key: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === key)!;
const click = async (key: string) => {
  await act(async () => button(key).click());
};
const render = async () => {
  await act(async () =>
    root.render(
      <InvitationManagement crewId="crew" userId="manager" generation={1} onClose={h.close} />
    )
  );
};
const open = async () => {
  await render();
  await click("Custom Role · 0/2");
};
const type = async (key: string, value: string) => {
  await act(async () => {
    const input = host.querySelector(`[aria-label="${key}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const lookup = async () => {
  await type("crewPositionInvites.recipient", "creator@example.com");
  await click("inviteManagement.lookup");
};
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockImplementation(async (path) =>
    path.endsWith("/members/me")
      ? { userId: "manager", permissions: ["openings.manage"] }
      : path === "/crews/crew/positions"
        ? { items: [position], nextCursor: null }
        : path === "/users/lookup"
          ? { userId: "creator", nickname: "Creator" }
          : { items: [row], nextCursor: null }
  );
  h.post.mockResolvedValue(row);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("shows permission failure without exposing positions", async () => {
  h.get.mockResolvedValue({ userId: "manager", permissions: [] });
  await render();
  expect(host.textContent).toContain("permission is required");
  expect(button("Custom Role · 0/2")).toBeUndefined();
});
it("requires recipient lookup before creation", async () => {
  await open();
  expect(button("crewPositionInvites.invite")).toBeUndefined();
  await lookup();
  expect(host.textContent).toContain("Creator");
  await click("crewPositionInvites.invite");
  expect(h.post).toHaveBeenCalledWith("/crew-positions/position/invitations", {
    service: "aurora",
    data: { inviteeUserId: "creator", expiresInDays: 7 },
  });
  expect(host.textContent).toContain("inviteManagement.saved");
});
it("invalidates the resolved recipient when contact changes", async () => {
  await open();
  await lookup();
  await type("crewPositionInvites.recipient", "other@example.com");
  expect(button("crewPositionInvites.invite")).toBeUndefined();
});
it("blocks invalid expiry and self-invites", async () => {
  await open();
  await lookup();
  await type("crewPositionInvites.days", "31");
  expect(button("crewPositionInvites.invite").disabled).toBe(true);
});
it("requires list review after ambiguous creation without retrying", async () => {
  h.post.mockRejectedValue(new Error("Network"));
  await open();
  await lookup();
  await click("crewPositionInvites.invite");
  expect(host.textContent).toContain("inviteManagement.uncertain");
  expect(button("crewPositionInvites.invite").disabled).toBe(true);
  expect(button("crewPositionInvites.retry")).toBeUndefined();
  expect(h.post).toHaveBeenCalledTimes(1);
  await click("crewPositionInvites.refresh");
  expect(button("crewPositionInvites.invite")).toBeUndefined();
});
it("retries only the selected revocation", async () => {
  h.post
    .mockRejectedValueOnce(new Error("Network"))
    .mockResolvedValue({ id: row.id, status: "revoked" });
  await open();
  const target = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("crewPositionInvites.revoke")
  )!;
  await act(async () => target.click());
  await click("crewPositionInvites.retry");
  expect(h.post.mock.calls[1]).toEqual(h.post.mock.calls[0]);
  expect(host.textContent).toContain("inviteManagement.saved");
});
it("locks repeated creation taps", async () => {
  let resolve!: (v: unknown) => void;
  h.post.mockReturnValue(new Promise((r) => (resolve = r)));
  await open();
  await lookup();
  await act(async () => {
    button("crewPositionInvites.invite").click();
    button("crewPositionInvites.invite").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(button("nativeApplications.back").disabled).toBe(true);
  await act(async () => resolve(row));
});
it("ignores late lookup after leaving", async () => {
  let resolve!: (v: unknown) => void;
  await open();
  h.get.mockReturnValue(new Promise((r) => (resolve = r)));
  await type("crewPositionInvites.recipient", "creator@example.com");
  await click("inviteManagement.lookup");
  await act(async () => root.render(null));
  await act(async () => resolve({ userId: "creator", nickname: "Creator" }));
  expect(host.textContent).toBe("");
});
it("blocks writes after account changes", async () => {
  await open();
  await lookup();
  h.generation = 2;
  await click("crewPositionInvites.invite");
  expect(h.post).not.toHaveBeenCalled();
});

it("opens position creation and refreshes the list on return", async () => {
  await render();
  await click("positionCreate.title");
  expect(host.textContent).toBe("Create Position Form");
  await click("Create Position Form");
  expect(h.get.mock.calls.filter((c) => c[0] === "/crews/crew/positions")).toHaveLength(2);
});

it("opens lifecycle controls and refreshes the list on return", async () => {
  await render();
  await click("positionLifecycle.manage");
  await click("Lifecycle Form");
  expect(h.get.mock.calls.filter((c) => c[0] === "/crews/crew/positions")).toHaveLength(2);
});

it("opens editing and refreshes positions on return", async () => {
  await render();
  await click("positionEdit.action");
  await click("Edit Form");
  expect(h.get.mock.calls.filter((c) => c[0] === "/crews/crew/positions")).toHaveLength(2);
});
