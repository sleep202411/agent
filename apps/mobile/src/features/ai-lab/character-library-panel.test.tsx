import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CharacterLibraryPanel } from "./character-library-panel";
const h = vi.hoisted(() => ({ generation: 1, focused: true, load: vi.fn(), characters: vi.fn() }));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useIsFocused: () => h.focused,
}));
vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "key" } }));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./enrollment-panel", () => ({ EnrollmentPanel: () => null }));
vi.mock("./project-likeness-consent", () => ({ EnrollmentConsent: () => null }));
vi.mock("./character-media-panel", () => ({ CharacterMediaPanel: () => null }));
vi.mock("@/features/agent/api/studio-projects-api", () => ({
  loadAgentWorkspaces: h.load,
  canCreateStudioProject: () => true,
}));
vi.mock("./character-library-api", () => ({
  loadCharacterLibrary: h.characters,
  characterLibraryBox: () => ({ read: () => null }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => null,
  TextInput: () => <input />,
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const personal = { id: "personal", name: "Personal", isDefault: true },
  team = { id: "team", name: "Team", isDefault: false };
const mount = () =>
  act(async () => root.render(<CharacterLibraryPanel userId="alice" generation={1} />));
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.focused = true;
  h.load.mockResolvedValue([personal, team]);
  h.characters.mockResolvedValue([]);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("retains the chosen library workspace after refreshing the roster", async () => {
  await mount();
  await click("Team");
  await click("likenessGrants.refresh");
  expect(h.characters.mock.calls.map((call) => call[0])).toEqual(["personal", "team", "team"]);
  expect(host.textContent).toContain("✓ Team");
});
it("does not load a different library after access loss until explicitly selected", async () => {
  await mount();
  await click("Team");
  h.load.mockResolvedValue([personal]);
  await click("likenessGrants.refresh");
  expect(h.characters).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("aiLab.workspaceUnavailable");
  expect(host.textContent).not.toContain("characterLibrary.create");
  await click("Personal");
  expect(h.characters).toHaveBeenLastCalledWith("personal", 1, expect.any(AbortSignal));
  expect(host.textContent).not.toContain("aiLab.workspaceUnavailable");
});
it("preserves workspace intent through a failed roster refresh and retry", async () => {
  await mount();
  await click("Team");
  h.load.mockRejectedValueOnce(new Error("Roster unavailable"));
  await click("likenessGrants.refresh");
  expect(host.textContent).toContain("Roster unavailable");
  expect(host.textContent).not.toContain("characterLibrary.create");
  await click("likenessGrants.refresh");
  expect(h.characters).toHaveBeenLastCalledWith("team", 1, expect.any(AbortSignal));
  expect(host.textContent).not.toContain("Roster unavailable");
});
it("aborts an abandoned roster lookup and ignores its late response", async () => {
  let resolve!: (rows: (typeof personal)[]) => void;
  h.load.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    })
  );
  await mount();
  const signal = h.load.mock.calls[0][0] as AbortSignal;
  h.focused = false;
  await mount();
  expect(signal.aborted).toBe(true);
  await act(async () => resolve([personal]));
  expect(h.characters).not.toHaveBeenCalled();
});
