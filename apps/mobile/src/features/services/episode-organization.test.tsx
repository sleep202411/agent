import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { EpisodeOrganization } from "./episode-organization";
const h = vi.hoisted(() => ({
  generation: 1,
  active: true,
  focused: true,
  rows: vi.fn(),
  access: vi.fn(),
  move: vi.fn(),
  remove: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./episode-create-api", () => ({ fetchEpisodeCreateAccess: h.access }));
vi.mock("./episode-management-api", () => ({ fetchCrewEpisodes: h.rows }));
vi.mock("./episode-organization-api", () => ({ moveEpisode: h.move, removeEpisode: h.remove }));
vi.mock("expo-router", () => ({ useIsFocused: () => h.focused }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({ text: "white" }) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children, style }: { children: ReactNode; style?: { display?: "none" | "flex" } }) => (
    <div style={{ display: style?.display }}>{children}</div>
  ),
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
const rows = [
  { id: "first", number: 1, title: "First", taskProgress: { total: 0 } },
  { id: "second", number: 2, title: "Second", taskProgress: { total: 1 } },
];
const buttons = (name: string) =>
  [...host.querySelectorAll("button")].filter((b) => b.textContent === name);
const click = (name: string, index = 0) => act(async () => buttons(name)[index]!.click());
const render = () =>
  act(async () =>
    root.render(
      <EpisodeOrganization crewId="crew" userId="user" generation={1} onClose={h.close} />
    )
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.focused = true;
  h.rows.mockResolvedValue(rows);
  h.access.mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("requires refreshed production management permission", async () => {
  h.access.mockResolvedValue(false);
  await render();
  expect(host.textContent).toContain("episodeOrganization.denied");
  expect(buttons("episodeOrganization.up")).toHaveLength(0);
});
it("disables boundary movements and removal of task-bearing episodes", async () => {
  await render();
  expect(buttons("episodeOrganization.up")[0]!.disabled).toBe(true);
  expect(buttons("episodeOrganization.down")[1]!.disabled).toBe(true);
  expect(buttons("episodeOrganization.remove")[1]!.disabled).toBe(true);
});
it("requires explicit deletion confirmation and allows cancellation without writing", async () => {
  await render();
  await click("episodeOrganization.remove");
  expect(h.remove).not.toHaveBeenCalled();
  expect(host.textContent).toContain("episodeOrganization.confirmHelp");
  await click("episodeOrganization.cancel");
  expect(buttons("episodeOrganization.confirm")).toHaveLength(0);
  expect(h.remove).not.toHaveBeenCalled();
});
it("prevents duplicate confirmed deletions and freezes after server conflicts", async () => {
  h.remove.mockRejectedValue(new Error("Delivery history exists"));
  await render();
  await click("episodeOrganization.remove");
  await act(async () => {
    buttons("episodeOrganization.confirm")[0]!.click();
    buttons("episodeOrganization.confirm")[0]!.click();
  });
  expect(h.remove).toHaveBeenCalledExactlyOnceWith(rows[0], 1);
  expect(host.textContent).toContain("Delivery history exists");
  expect(buttons("episodeOrganization.confirm")[0]!.disabled).toBe(true);
  await click("thread.refresh");
  expect(h.rows).toHaveBeenCalledTimes(2);
});
it("moves against the original list once and refreshes authoritative order", async () => {
  h.move.mockResolvedValue({});
  await render();
  await act(async () => {
    buttons("episodeOrganization.up")[1]!.click();
    buttons("episodeOrganization.up")[1]!.click();
  });
  expect(h.move).toHaveBeenCalledExactlyOnceWith(rows, "second", "up", 1);
  expect(host.textContent).toContain("episodeOrganization.saved");
  h.rows.mockResolvedValue([...rows].reverse());
  await click("thread.refresh");
  expect(host.textContent!.indexOf("Second")).toBeLessThan(host.textContent!.indexOf("First"));
});
it("blocks writes after an account change", async () => {
  await render();
  h.generation = 2;
  await click("episodeOrganization.up", 1);
  expect(h.move).not.toHaveBeenCalled();
  await render();
  expect(host.textContent).toBe("");
});

it("preserves an uncertain removal through background without enabling another write", async () => {
  h.remove.mockRejectedValue(new Error("Response lost"));
  await render();
  await click("episodeOrganization.remove");
  await click("episodeOrganization.confirm");
  h.active = false;
  await render();
  h.active = true;
  await render();
  expect(host.textContent).toContain("Response lost");
  expect(buttons("episodeOrganization.confirm")[0]!.disabled).toBe(true);
  expect(h.remove).toHaveBeenCalledTimes(1);
});
