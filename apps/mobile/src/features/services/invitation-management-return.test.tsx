import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import InvitationManagementScreen from "../../app/crew-invitations/[id]";
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useIsFocused: () => h.focused,
  useLocalSearchParams: () => ({ id: "crew" }),
  useRouter: () => ({ back: h.close }),
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, status: "authenticated", user: { id: "manager" } }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active && h.focused }));
vi.mock("@/config/app-env", () => ({ isChinaRegion: false }));
vi.mock("./task-picker", () => ({ TaskPicker: () => null }));
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  focused: true,
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get, post: h.post, patch: h.patch } }));
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
  await act(async () => root.render(<InvitationManagementScreen />));
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
  h.active = true;
  h.focused = true;
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

it("preserves position description through background and permission-read failure", async () => {
  await render();
  await click("positionCreate.title");
  await type("positionCreate.description", "Storyboard artist for production");
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
  h.get.mockRejectedValueOnce(new Error("Access unavailable"));
  h.active = true;
  await render();
  expect(button("positionCreate.publish")).toBeUndefined();
  await click("common.retry");
  expect(
    host.querySelector<HTMLTextAreaElement>('textarea[aria-label="positionCreate.description"]')
      ?.value
  ).toBe("Storyboard artist for production");
  expect(host.textContent).not.toContain("Access unavailable");
  expect(h.post).not.toHaveBeenCalled();
});
it("preserves recipient and expiry after background and denies actions until access reloads", async () => {
  await open();
  await lookup();
  await type("crewPositionInvites.days", "12");
  h.active = false;
  await render();
  h.get.mockRejectedValueOnce(new Error("Access unavailable"));
  h.active = true;
  await render();
  expect(button("crewPositionInvites.invite")).toBeUndefined();
  await click("common.retry");
  expect(
    host.querySelector<HTMLTextAreaElement>('textarea[aria-label="crewPositionInvites.recipient"]')
      ?.value
  ).toBe("creator@example.com");
  expect(
    host.querySelector<HTMLTextAreaElement>('textarea[aria-label="crewPositionInvites.days"]')
      ?.value
  ).toBe("12");
  expect(host.textContent).not.toContain("Access unavailable");
  expect(h.post).not.toHaveBeenCalled();
  await click("crewPositionInvites.invite");
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(h.post.mock.calls[0][1].data.expiresInDays).toBe(12);
});
it("retains uncertain invitation protection on foreground return", async () => {
  await open();
  await lookup();
  h.post.mockRejectedValueOnce(new Error("Response lost"));
  await click("crewPositionInvites.invite");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(button("crewPositionInvites.invite").disabled).toBe(true);
  expect(host.textContent).toContain("Response lost");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it.each(["route", "account"])("retires the recipient draft on %s change", async (change) => {
  await open();
  await lookup();
  if (change === "route") h.focused = false;
  else h.generation++;
  await render();
  h.focused = true;
  await render();
  await click("Custom Role · 0/2");
  expect(
    host.querySelector<HTMLTextAreaElement>('textarea[aria-label="crewPositionInvites.recipient"]')
      ?.value
  ).toBe("");
});

it("keeps an edited position draft and refuses overwriting a changed server baseline", async () => {
  const editing = {
    ...position,
    taskId: null,
    recruitmentVisibility: "public",
    description: "Original role",
    workMode: "remote",
    location: null,
    employmentType: "project_based",
    experienceLevel: "any",
    requiredSkills: [],
    salary: {
      currency: "USD",
      period: "project",
      minAmount: null,
      maxAmount: null,
      negotiable: true,
    },
    durationMonths: null,
    revenueSharePercent: null,
    closeDate: null,
  };
  h.get.mockImplementation(async (path) =>
    path.endsWith("/members/me")
      ? { userId: "manager", permissions: ["openings.manage"] }
      : { items: [editing], nextCursor: null }
  );
  await render();
  await click("positionEdit.action");
  await type("positionCreate.description", "My retained edit");
  h.active = false;
  await render();
  editing.description = "Another manager edited this";
  h.active = true;
  await render();
  expect(
    host.querySelector<HTMLTextAreaElement>('[aria-label="positionCreate.description"]')?.value
  ).toBe("My retained edit");
  await click("positionEdit.save");
  expect(host.textContent).toContain("Position changed");
  expect(h.patch).not.toHaveBeenCalled();
});
it("keeps uncertain lifecycle writes locked after background and fresh access", async () => {
  await render();
  await click("positionLifecycle.manage");
  await click("positionLifecycle.freeze");
  h.patch.mockRejectedValueOnce(new Error("Response lost"));
  await click("positionLifecycle.confirm");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(host.textContent).toContain("Response lost");
  expect(button("positionLifecycle.confirm")).toBeUndefined();
  expect(h.patch).toHaveBeenCalledTimes(1);
});
