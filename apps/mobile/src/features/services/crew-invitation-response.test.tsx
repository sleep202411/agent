import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewInvitationResponse } from "./crew-invitation-response";
const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), generation: 1, open: vi.fn() }));
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
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  crewId: "shortCrew",
  inviteeUserId: "user",
  status: "pending",
  expiresAt: "2099-01-01T00:00:00Z",
  crew: { id: "shortCrew", name: "Film crew", logo: null, tagline: null },
  agreementRequest: {
    title: "Film agreement",
    signerName: "Artist",
    signerEmail: "a@example.com",
    agreementId: null,
    status: null,
  },
};
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name)!;
const render = () =>
  act(async () =>
    root.render(
      <CrewInvitationResponse
        invitationId={row.id}
        userId="user"
        generation={1}
        onOpenCrew={h.open}
      />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.get.mockResolvedValue(row);
  h.post.mockResolvedValue({ accepted: true, crewId: row.crewId, memberId: "member" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("discloses agreement and only joins on explicit accept, rejecting duplicate taps", async () => {
  await render();
  expect(host.textContent).toContain("Film agreement");
  expect(host.textContent).toContain("crewInvitations.agreementAfterAccept");
  expect(h.post).not.toHaveBeenCalled();
  await act(async () => {
    button("crewInvitations.accept").click();
    button("crewInvitations.accept").click();
  });
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.open).toHaveBeenCalledWith("shortCrew");
});
it("refreshes instead of resending after a lost acceptance response", async () => {
  await render();
  h.post.mockImplementation(async () => {
    h.get.mockResolvedValue({ ...row, status: "accepted" });
    throw new Error("Connection lost");
  });
  await act(async () => button("crewInvitations.accept").click());
  expect(host.textContent).toContain("Connection lost");
  expect(button("crewInvitations.accept")).toBeUndefined();
  await act(async () => button("thread.refresh").click());
  expect(host.textContent).toContain("crewInvitations.status.accepted");
  expect(h.post).toHaveBeenCalledTimes(1);
  await act(async () => button("crewTasks.title").click());
  expect(h.open).toHaveBeenCalledWith("shortCrew");
});
it("declines then rereads the terminal invitation", async () => {
  await render();
  h.post.mockImplementation(async () => {
    h.get.mockResolvedValue({ ...row, status: "declined" });
    return { declined: true };
  });
  await act(async () => button("crewInvitations.decline").click());
  expect(host.textContent).toContain("crewInvitations.status.declined");
  expect(button("crewInvitations.accept")).toBeUndefined();
  expect(h.open).not.toHaveBeenCalled();
});
it("does not expose actions for expired invitations", async () => {
  h.get.mockResolvedValue({ ...row, expiresAt: "2000-01-01T00:00:00Z" });
  await render();
  expect(host.textContent).toContain("crewInvitations.status.expired");
  expect(button("crewInvitations.accept")).toBeUndefined();
});
it("ignores late results after account changes and aborts on unmount", async () => {
  let finish!: (v: unknown) => void;
  h.get.mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  await render();
  h.generation = 2;
  await act(async () => finish(row));
  expect(host.textContent).not.toContain("Film crew");
  await act(async () => root.render(null));
  expect(h.get.mock.calls[0][1].signal.aborted).toBe(true);
});

it("shows the invitation position and access before acceptance", async () => {
  h.get.mockResolvedValue({ ...row, positionCategory: "director", policyKeys: ["finance"] });
  await render();
  expect(host.textContent).toContain("crewRoles.director");
  expect(host.textContent).toContain("crewMembers.finance");
  expect(h.post).not.toHaveBeenCalled();
});
