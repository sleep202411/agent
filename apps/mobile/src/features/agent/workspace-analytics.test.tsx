import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceAnalyticsScreen } from "./workspace-analytics";
const h = vi.hoisted(() => ({ generation: 1, active: true, focused: true, load: vi.fn() }));
vi.mock("./api/workspace-analytics-api", async (original) => ({
  ...(await original<typeof import("./api/workspace-analytics-api")>()),
  loadWorkspaceAnalytics: h.load,
}));
vi.mock("./api/studio-workspace-settings-api", () => ({}));
vi.mock("./api/platform-projects-api", () => ({}));
vi.mock("./api/studio-members-api", () => ({}));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
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
    accessibilityRole,
    accessibilityState,
  }: {
    children: ReactNode;
    onPress: () => void;
    accessibilityRole?: string;
    accessibilityState?: { selected?: boolean };
  }) => (
    <button onClick={onPress} role={accessibilityRole} aria-selected={accessibilityState?.selected}>
      {children}
    </button>
  ),
}));
const data = (memberUsage: unknown = []) => ({
  workspace: { name: "Team" },
  projects: [],
  ledger: [],
  daily: [],
  jobs: [],
  memberUsage,
});
let root: Root, host: HTMLDivElement;
const mount = (workspaceId = "team") =>
  act(async () =>
    root.render(
      <WorkspaceAnalyticsScreen workspaceId={workspaceId} generation={1} onClose={() => {}} />
    )
  );
const click = async (label: string) => {
  const target = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(target).toBeTruthy();
  await act(async () => target!.click());
};
beforeEach(() => {
  vi.clearAllMocks();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  h.load.mockResolvedValue(data());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("returns to daily usage when refresh removes member access", async () => {
  await mount();
  await click("workspaceAnalytics.members");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    "workspaceAnalytics.members"
  );
  h.load.mockResolvedValue({ ...data(), memberUsage: undefined });
  await click("workspaceAnalytics.refresh");
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    "workspaceAnalytics.daily"
  );
  expect(host.textContent).toContain("workspaceAnalytics.dailyWindow");
  expect(
    [...host.querySelectorAll('[role="tab"]')].some(
      (b) => b.textContent === "workspaceAnalytics.members"
    )
  ).toBe(false);
});
it("shows the upstream failure and retries without presenting failed reads as zero usage", async () => {
  h.load.mockRejectedValueOnce(new Error("Usage service unavailable"));
  await mount();
  expect(host.textContent).toContain("Usage service unavailable");
  expect(host.textContent).not.toContain("workspaceAnalytics.incoming");
  await click("workspaceAnalytics.refresh");
  expect(host.textContent).not.toContain("Usage service unavailable");
  expect(host.textContent).toContain("workspaceAnalytics.dailyWindow");
});
it("aborts old workspace reads and ignores a late result after navigation", async () => {
  let resolve!: (value: unknown) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  await mount("old");
  const signal = h.load.mock.calls[0][4] as AbortSignal;
  await mount("new");
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ ...data(), workspace: { name: "Retired workspace" } }));
  expect(host.textContent).not.toContain("Retired workspace");
  expect(host.textContent).toContain("Team");
});

it("keeps project, range and tab through background while rechecking the report before display", async () => {
  h.load.mockResolvedValue({ ...data(), projects: [{ id: "project", name: "Film" }] });
  await mount();
  await click("workspaceAnalytics.members");
  await click("Film");
  await click("90 workspaceAnalytics.days");
  const before = h.load.mock.calls.at(-1)!;
  h.active = false;
  await mount();
  expect((before[4] as AbortSignal).aborted).toBe(true);
  expect(host.textContent).toBe("");
  let resolve!: (value: unknown) => void;
  h.load.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  h.active = true;
  await mount();
  expect(h.load).toHaveBeenLastCalledWith("team", 1, "project", 90, expect.any(AbortSignal));
  expect(host.textContent).not.toContain("Team");
  expect(host.textContent).toContain("loading");
  await act(async () => resolve({ ...data(), projects: [{ id: "project", name: "Film" }] }));
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    "workspaceAnalytics.members"
  );
  expect(
    [...host.querySelectorAll('[role="radio"][aria-selected="true"]')].map(
      (node) => node.textContent
    )
  ).toEqual(["Film", "90 workspaceAnalytics.days"]);
});
it("removes member data when foreground refresh loses permission", async () => {
  await mount();
  await click("workspaceAnalytics.members");
  h.active = false;
  await mount();
  h.load.mockResolvedValue({ ...data(), memberUsage: undefined });
  h.active = true;
  await mount();
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    "workspaceAnalytics.daily"
  );
  expect(host.textContent).not.toContain("workspaceAnalytics.members");
});
it("retires filters on route exit", async () => {
  await mount();
  await click("workspaceAnalytics.members");
  await click("90 workspaceAnalytics.days");
  h.focused = false;
  await mount();
  expect(host.textContent).toBe("");
  h.focused = true;
  await mount();
  expect(h.load).toHaveBeenLastCalledWith("team", 1, "", 30, expect.any(AbortSignal));
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
    "workspaceAnalytics.daily"
  );
});
