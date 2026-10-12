import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CrewWorkEntry } from "./crew-work-entry";
const h = vi.hoisted(() => ({
  active: true,
  focused: true,
  generation: 1,
  get: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/api-client", () => ({
  api: { get: h.get },
  ApiRequestError: class extends Error {},
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("expo-router", () => ({
  useIsFocused: () => h.focused,
  useRouter: () => ({ replace: h.replace, push: h.push }),
}));
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
  ActivityIndicator: () => null,
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
  }: {
    value: string;
    onChangeText: (s: string) => void;
    accessibilityLabel: string;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
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
}));

vi.mock("./crew-creation", () => ({
  CrewCreation: ({ onCreated }: { onCreated: (id: string) => void }) => (
    <button onClick={() => onCreated("new-crew")}>complete new crew</button>
  ),
}));
vi.mock("./task-workbench", () => ({
  TaskWorkbench: ({ crewId, onCreated }: { crewId: string; onCreated: (id: string) => void }) => (
    <button onClick={() => onCreated("task")}>task editor:{crewId}</button>
  ),
}));
vi.mock("./position-create", () => ({
  PositionCreate: ({ crewId }: { crewId: string }) => <span>position editor:{crewId}</span>,
}));
let root: Root, host: HTMLDivElement;
const mount = (mode: "task" | "position" = "task") =>
  act(async () =>
    root.render(<CrewWorkEntry userId="alice" generation={1} mode={mode} onClose={() => {}} />)
  );
const click = (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click();
  });
beforeEach(() => {
  vi.clearAllMocks();
  h.active = true;
  h.generation = 1;
  h.get.mockImplementation(async (path: string) =>
    path === "/crews/my"
      ? { founded: [{ id: "crew", name: "River" }], joined: [{ id: "crew", name: "River" }] }
      : { userId: "alice", permissions: ["tasks.view"] }
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("deduplicates owned/joined Crews and continues into the existing task editor", async () => {
  await mount();
  expect(
    [...host.querySelectorAll("button")].filter((b) => b.textContent === "○ River")
  ).toHaveLength(1);
  await click("○ River");
  await click("taskEntry.continue");
  await click("task editor:crew");
  expect(h.replace).toHaveBeenCalledWith("/crew-tasks/crew?task=task");
});
it("requires position permission independently from task permission", async () => {
  await mount("position");
  await click("○ River");
  expect(host.textContent).toContain("taskEntry.cannotManagePositions");
  expect(host.textContent).not.toContain("taskEntry.continuePosition");
});
it.each(["task", "position"] as const)(
  "continues a new Crew into the requested %s editor",
  async (mode) => {
    await mount(mode);
    await click("taskEntry.newCrew");
    await click("complete new crew");
    expect(host.textContent).toContain(`${mode} editor:new-crew`);
  }
);
it("rechecks permission after background and hides old accounts", async () => {
  await mount();
  await click("○ River");
  h.active = false;
  await mount();
  h.get.mockRejectedValue(Error("Permission changed"));
  h.active = true;
  await mount();
  expect(host.textContent).not.toContain("taskEntry.continue");
  expect(host.textContent).toContain("Permission changed");
  h.generation = 2;
  await mount();
  expect(host.textContent).toBe("");
});
