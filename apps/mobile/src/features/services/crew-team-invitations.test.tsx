import { encodeUserId } from "@repo/shared/user-id-codec";
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewTeamInvitations } from "./crew-team-invitations";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  generation: 1,
  open: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({ api: h }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
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
    <input
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;

vi.mock("@/lib/durable-record", () => ({
  durableRecord: (namespace: string, user: string, crew: string) => ({
    read: () => h.records.get(`${namespace}:${user}:${crew}`) ?? null,
    write: (v: string) => h.records.set(`${namespace}:${user}:${crew}`, v),
  }),
}));
vi.mock("./user-displays", () => ({ useUserDisplays: () => new Map() }));
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "crew",
  inviteeUserId: "artist",
  invitedByUserId: "actor",
  positionCategory: null,
  policyKeys: [],
  status: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
  createdAt: "2026-10-01T00:00:00Z",
  agreementRequest: null,
};
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <CrewTeamInvitations crewId="crew" userId="actor" generation={1} onClose={h.open} />
      </StrictMode>
    )
  );
const fill = (label: string, value: string) =>
  act(async () => {
    const node = host.querySelector(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.records.clear();
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me")
      ? {
          userId: "actor",
          permissions: ["members.invite", "members.manage", "members.permissions.manage"],
        }
      : path === "/users/lookup" || path === "/users/by-id"
        ? { userId: "artist", nickname: "Artist", isCrewMember: false }
        : { items: [], nextCursor: null, total: 0 }
  );
  h.post.mockResolvedValue(row);
  h.delete.mockResolvedValue({ revoked: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("loads under strict effects and requires recipient review before a single send", async () => {
  await render();
  await fill("teamInvites.account", "artist@example.com");
  await act(async () => button("teamInvites.lookup").click());
  expect(host.textContent).toContain("Artist");
  expect(h.post).not.toHaveBeenCalled();
  await act(async () => {
    button("teamInvites.send").click();
    button("teamInvites.send").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0][1].data).toEqual({
    account: "artist@example.com",
    policyKeys: [],
    expiresInDays: 7,
  });
});
it("assigns a role without implicitly granting policies", async () => {
  await render();
  await fill("teamInvites.account", "artist@example.com");
  await act(async () => button("teamInvites.position").click());
  await act(async () => button("crewRoles.director").click());
  await act(async () => button("teamInvites.lookup").click());
  h.post.mockResolvedValue({ ...row, positionCategory: "director" });
  await act(async () => button("teamInvites.send").click());
  expect(h.post.mock.calls[0][1].data).toMatchObject({
    positionCategory: "director",
    policyKeys: [],
  });
});
it("retains an uncertain send across remount and does not resend while reviewing", async () => {
  await render();
  await fill("teamInvites.account", "artist@example.com");
  await act(async () => button("teamInvites.lookup").click());
  h.post.mockRejectedValue(new Error("Network lost"));
  await act(async () => button("teamInvites.send").click());
  expect(host.textContent).toContain("teamInvites.unknown");
  await act(async () => root.render(null));
  await render();
  expect(host.textContent).toContain("artist@example.com");
  expect(button("teamInvites.lookup").disabled).toBe(true);
  await act(async () => button("thread.refresh").click());
  expect(h.post).toHaveBeenCalledTimes(1);
  await act(async () => button("teamInvites.reviewed").click());
  expect(host.textContent).toContain("teamInvites.unknown");
  await act(async () => button("teamInvites.confirmClear").click());
  expect(host.textContent).not.toContain("teamInvites.unknown");
});
it("hides grants and rejects stale access after refresh", async () => {
  await render();
  h.get.mockResolvedValue({ userId: "actor", permissions: [] });
  await act(async () => button("thread.refresh").click());
  expect(button("teamInvites.lookup").disabled).toBe(true);
  expect(button("crewMembers.finance")).toBeUndefined();
  expect(host.textContent).toContain("permission");
  expect(h.post).not.toHaveBeenCalled();
});
it("requires confirmation to revoke and refreshes without replay after a lost response", async () => {
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions: ["members.invite"] }
      : { items: [row], nextCursor: null, total: 1 }
  );
  await render();
  await act(async () => button("teamInvites.revoke").click());
  expect(h.delete).not.toHaveBeenCalled();
  h.delete.mockRejectedValue(new Error("Lost revoke response"));
  await act(async () => button("teamInvites.confirmRevoke").click());
  expect(h.delete).toHaveBeenCalledTimes(1);
  expect(button("teamInvites.revoke").disabled).toBe(true);
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/me")
      ? { userId: "actor", permissions: ["members.invite"] }
      : { items: [], nextCursor: null, total: 0 }
  );
  await act(async () => button("thread.refresh").click());
  expect(button("teamInvites.revoke")).toBeUndefined();
  expect(h.delete).toHaveBeenCalledTimes(1);
});

it("requires explicit ID mode and a fresh review after switching modes", async () => {
  const publicId = encodeUserId("123456789012345678");
  await render();
  await fill("teamInvites.account", "42");
  expect(button("teamInvites.lookup").disabled).toBe(true);
  await act(async () => button("teamInvites.useUserId").click());
  await fill("teamInvites.userId", publicId);
  await act(async () => button("teamInvites.lookup").click());
  expect(h.get).toHaveBeenCalledWith(
    "/users/by-id",
    expect.objectContaining({ params: { id: publicId, idFormat: "public", checkCrewId: "crew" } })
  );
  await act(async () => button("teamInvites.useContact").click());
  expect(host.textContent).not.toContain("teamInvites.confirmHelp");
  expect(button("teamInvites.lookup").disabled).toBe(true);
  await act(async () => button("teamInvites.useUserId").click());
  await fill("teamInvites.userId", publicId);
  await act(async () => button("teamInvites.lookup").click());
  await act(async () => button("teamInvites.send").click());
  expect(h.post).toHaveBeenCalledWith(
    "/crews/crew/invitations",
    expect.objectContaining({
      data: { account: publicId, lookupBy: "userId", policyKeys: [], expiresInDays: 7 },
    })
  );
});
