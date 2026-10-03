import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IpGovernancePanel } from "./governance-panel";
const h = vi.hoisted(() => ({
  signedIn: true,
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  push: vi.fn(),
  key: 10,
  open: vi.fn(),
  records: new Map<string, string>(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get, put: h.put, patch: h.patch, post: h.post, delete: h.del },
  ApiRequestError: class extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: (ns: string, user: string, id: string) => ({
    read: () => h.records.get(`${ns}:${user}:${id}`) ?? null,
    write: (s: string) => h.records.set(`${ns}:${user}:${id}`, s),
  }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => `00000000-0000-4000-8000-${String(++h.key).padStart(12, "0")}` },
}));
vi.mock("@/components/authed-web-view", () => ({
  AuthedWebView: ({ path }: { path: string }) => <div>web:{path}</div>,
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  View: ({ children, style }: { children: ReactNode; style?: { display?: "none" | "flex" } }) => (
    <div style={{ display: style?.display }}>{children}</div>
  ),
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled: boolean;
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
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      readOnly={!editable}
      aria-label={accessibilityLabel}
    />
  ),
}));

vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: vi.fn() }));
vi.mock("@/features/services/conversation-video", () => ({
  ConversationVideo: () => <div>Video preview</div>,
}));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useLocalSearchParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
  useRouter: () => ({ push: h.push }),
  Stack: {
    Screen: ({ options }: { options: { headerRight?: () => ReactNode } }) => (
      <>{options.headerRight?.()}</>
    ),
  },
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({
    status: h.signedIn ? "authenticated" : "anonymous",
    user: { userId: "alice" },
    generation: 1,
  }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/features/ip-author/contributors-panel", () => ({ IpContributorsPanel: () => null }));
const id = "11111111-1111-4111-8111-111111111111",
  gameId = "22222222-2222-4222-8222-222222222222",
  otherId = "33333333-3333-4333-8333-333333333333";
let games: {
  gameId: string;
  title: string;
  version: number;
  linked: boolean;
  linkedElsewhere: boolean;
}[];
let applications: {
  id: string;
  applicantId: string;
  stage: string;
  stageVersion: number;
  reason: string;
  status: string;
  reviewReason: string | null;
}[];
let root: Root, host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mount = () =>
  act(async () => root.render(<IpGovernancePanel ipId={id} userId="alice" generation={1} />));
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
const type = (value: string) =>
  act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[aria-label="ipProduction.reason"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
beforeEach(() => {
  vi.resetAllMocks();
  h.records.clear();
  h.active = true;
  h.focused = true;
  h.generation = 1;
  games = [
    { gameId, title: "My game", version: 0, linked: false, linkedElsewhere: false },
    { gameId: otherId, title: "Another IP game", version: 2, linked: false, linkedElsewhere: true },
  ];
  applications = [];
  h.get.mockImplementation(async (path: string) =>
    path.endsWith("/owned-games")
      ? { code: 200, items: games, nextCursor: null }
      : path.endsWith("/stage-applications")
        ? { code: 200, state: { stage: "testing", version: 1 }, items: applications }
        : { ip: { id, title: "Story", version: 1 } }
  );
  h.post.mockImplementation(async (path: string, { data }) => {
    if (path.includes("/games/")) {
      games[0] = { ...games[0], linked: data.active, version: data.expectedVersion + 1 };
      return { code: 200, gameId, active: data.active, version: data.expectedVersion + 1 };
    }
    const result = {
      id: data.id,
      applicantId: "alice",
      stage: data.stage,
      stageVersion: data.expectedVersion,
      reason: data.reason,
      status: "pending",
      reviewReason: null,
    };
    applications = [result];
    return { code: 200, ...result };
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("links and unlinks eligible owned games, preserving games linked to other IPs", async () => {
  await mount();
  await click("ipGovernance.games");
  expect(host.textContent).toContain("ipProduction.elsewhere");
  expect(
    [...host.querySelectorAll("button")].filter((x) => x.textContent === "ipProduction.link")
  ).toHaveLength(1);
  await click("ipProduction.link");
  expect(games[0].linked).toBe(true);
  await click("ipProduction.unlink");
  expect(games[0].linked).toBe(false);
});
it("loads more games and keeps loaded results after a page failure", async () => {
  h.get.mockImplementation(async (path: string, options) =>
    path.endsWith("/owned-games")
      ? options.params?.cursor
        ? Promise.reject(new Error("Page failed"))
        : { code: 200, items: [games[0]], nextCursor: gameId }
      : { ip: { id, title: "Story", version: 1 } }
  );
  await mount();
  await click("ipGovernance.games");
  await click("ipProduction.more");
  expect(host.textContent).toContain("Page failed");
  expect(host.textContent).toContain("My game");
  expect(button("ipProduction.more")).toBeDefined();
  h.get.mockResolvedValue({ code: 200, items: [games[1]], nextCursor: null });
  await click("ipProduction.more");
  expect(host.textContent).toContain("My game");
  expect(host.textContent).toContain("Another IP game");
  expect(button("ipProduction.more")).toBeUndefined();
});
it("retries a game request after remount with the original ID and version", async () => {
  h.post.mockRejectedValueOnce(new Error("Lost reply"));
  await mount();
  await click("ipGovernance.games");
  await click("ipProduction.link");
  expect(button("ipProduction.link").disabled).toBe(true);
  const original = h.post.mock.calls[0][1].data;
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  await click("ipGovernance.games");
  await click("common.retry");
  expect(h.post.mock.calls[1][1].data).toEqual(original);
  expect(host.textContent).not.toContain("ipProduction.pendingRequest");
});
it("submits a stage application and displays history without changing the current stage", async () => {
  await mount();
  await click("ipGovernance.stages");
  expect(button("ipProduction.submit").disabled).toBe(true);
  await click("○ ipProduction.production");
  await type("Ready to produce");
  await click("ipProduction.submit");
  expect(h.post).toHaveBeenCalledWith(
    expect.stringContaining("/stage-applications"),
    expect.objectContaining({
      data: expect.objectContaining({
        stage: "production",
        reason: "Ready to produce",
        expectedVersion: 1,
      }),
    })
  );
  expect(host.textContent).toContain("ipProduction.current: ipProduction.testing");
  expect(host.textContent).toContain("ipProduction.awaiting");
  expect(host.textContent).toContain("Ready to produce");
  expect(button("ipProduction.submit")).toBeUndefined();
});
it("keeps a pending stage request immutable and displays reviewed history", async () => {
  h.post.mockRejectedValueOnce(new Error("Lost reply"));
  await mount();
  await click("ipGovernance.stages");
  await type("Please review");
  await click("ipProduction.submit");
  expect(host.querySelector<HTMLInputElement>("input")!.readOnly).toBe(true);
  await click("common.retry");
  applications[0] = { ...applications[0], status: "rejected", reviewReason: "Need evidence" };
  await click("thread.refresh");
  expect(host.textContent).toContain("Need evidence");
  expect(button("ipProduction.submit")).toBeDefined();
});
it("requires a refreshed result and explicit confirmation to clear only the local pending record", async () => {
  h.post.mockRejectedValue(new Error("Version conflict"));
  await mount();
  await click("ipGovernance.games");
  await click("ipProduction.link");
  expect(button("ipProduction.checked")).toBeUndefined();
  await click("thread.refresh");
  await click("ipProduction.checked");
  await click("common.cancel");
  expect(host.textContent).toContain("ipProduction.pendingRequest");
  await click("ipProduction.checked");
  await click("ipProduction.confirmClear");
  expect(host.textContent).not.toContain("ipProduction.pendingRequest");
  expect(h.post).toHaveBeenCalledTimes(1);
});
it("hides private game rows when access is revoked or the screen becomes inactive", async () => {
  const { ApiRequestError } = await import("@/lib/api-client");
  await mount();
  await click("ipGovernance.games");
  h.get.mockRejectedValue(new ApiRequestError("FORBIDDEN", "Access removed", 403));
  await click("thread.refresh");
  expect(host.textContent).not.toContain("My game");
  h.active = false;
  await mount();
  expect((host.firstElementChild as HTMLElement).style.display).toBe("none");
});

it("preserves the nested stage reason and selected tab across background", async () => {
  await mount();
  await click("ipGovernance.stages");
  await click("○ ipProduction.production");
  await type("Ready after editing");
  h.active = false;
  await mount();
  expect((host.firstElementChild as HTMLElement).style.display).toBe("none");
  h.active = true;
  await mount();
  expect(
    host.querySelector<HTMLInputElement>('input[aria-label="ipProduction.reason"]')?.value
  ).toBe("Ready after editing");
  expect(h.post).not.toHaveBeenCalled();
  await click("ipProduction.submit");
  expect(h.post).toHaveBeenCalledWith(
    expect.stringContaining("/stage-applications"),
    expect.objectContaining({
      data: expect.objectContaining({
        stage: "production",
        reason: "Ready after editing",
        expectedVersion: 1,
      }),
    })
  );
});
