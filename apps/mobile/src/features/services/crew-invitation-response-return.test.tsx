import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import CrewInvitationResponseScreen from "../../app/crew-invitation-response/[id]";
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ replace: h.open }),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: "authenticated", generation: h.generation, user: { id: h.userId } }),
  useAuthGate: () => ({}),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/lib/navigation", () => ({ toHref: (value: string) => value }));
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  generation: 1,
  active: true,
  userId: "user",
  open: vi.fn(),
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
const render = () => act(async () => root.render(<CrewInvitationResponseScreen />));
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.userId = "user";
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

it.each(["accept", "decline"])(
  "rereads a committed %s after an interrupted response without replay",
  async (action) => {
    await render();
    let finish!: (value: unknown) => void;
    h.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    await act(async () => button(`crewInvitations.${action}`).click());
    expect(h.post).toHaveBeenCalledTimes(1);
    h.active = false;
    await render();
    expect(h.post.mock.calls[0][1].signal.aborted).toBe(true);
    h.get.mockResolvedValue({ ...row, status: action === "accept" ? "accepted" : "declined" });
    h.active = true;
    await render();
    await act(async () =>
      finish(
        action === "accept"
          ? { accepted: true, crewId: row.crewId, memberId: "member" }
          : { declined: true }
      )
    );
    expect(h.open).not.toHaveBeenCalled();
    expect(button("crewInvitations.accept")).toBeUndefined();
    expect(h.post).toHaveBeenCalledTimes(1);
    if (action === "accept") {
      await act(async () => button("crewTasks.title").click());
      expect(h.open).toHaveBeenCalledWith("/crew-tasks/shortCrew");
    } else expect(host.textContent).toContain("crewInvitations.status.declined");
  }
);
it("withholds decisions after a failed return read and recovers a revoked invitation", async () => {
  await render();
  h.active = false;
  await render();
  h.get.mockRejectedValueOnce(new Error("Access unavailable"));
  h.active = true;
  await render();
  expect(host.textContent).toContain("Access unavailable");
  expect(button("crewInvitations.accept")).toBeUndefined();
  h.get.mockResolvedValue({ ...row, status: "revoked" });
  await act(async () => button("thread.refresh").click());
  expect(host.textContent).toContain("crewInvitations.status.revoked");
  expect(h.post).not.toHaveBeenCalled();
});
it("rejects a late acceptance and old invitation after switching accounts", async () => {
  await render();
  let finish!: (value: unknown) => void;
  h.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => button("crewInvitations.accept").click());
  h.generation++;
  h.userId = "other";
  await render();
  await act(async () => finish({ accepted: true, crewId: row.crewId, memberId: "member" }));
  expect(h.open).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Invitation identity mismatch");
  expect(button("crewInvitations.accept")).toBeUndefined();
});
