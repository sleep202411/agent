import { Alert } from "react-native";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryRepairInteractionsEditor } from "./story-repair-interactions-editor";
const h = vi.hoisted(() => ({ raw: null as string | null, apply: vi.fn(), close: vi.fn() }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({
    read: () => h.raw,
    write: (value: string) => {
      h.raw = value;
    },
  }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: ({ value }: { value: string }) => <input value={value} readOnly />,
  Alert: { alert: vi.fn() },
  Pressable: ({
    children,
    disabled,
    onPress,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

vi.mock("expo-modules-core", () => ({ uuid: { v4: () => "new" } }));
vi.mock("./story-repair-effects-editor", () => ({ StoryRepairEffectsEditor: () => null }));
const content = {
  storyBible: {},
  graph: { entryNodeId: "a", nodes: [{ kind: "clip", nodeId: "a", interactions: [] }] },
};
let host: HTMLDivElement, root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  h.raw = null;
  h.apply.mockReturnValue(true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = (canEdit = true) =>
  act(async () =>
    root.render(
      <StoryRepairInteractionsEditor
        scope={{ projectId: "project", chapterId: "chapter", generation: 1 }}
        content={content}
        nodeId="a"
        defaultLocale="en-US"
        userId="user"
        storageKey="scene"
        canEdit={canEdit}
        onApply={h.apply}
        onClose={h.close}
      />
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
it("persists new hotspots before Apply, retains rejected edits and clears after acceptance", async () => {
  await render();
  await click("storyHotspot.add");
  expect(JSON.parse(h.raw!).rows).toHaveLength(1);
  h.apply.mockReturnValue(false);
  await click("storyHotspot.apply");
  expect(host.textContent).toContain("storyCondition.applyFailed");
  expect(h.close).not.toHaveBeenCalled();
  h.apply.mockReturnValue(true);
  await click("storyHotspot.apply");
  expect(h.raw).toBe("null");
  expect(h.close).toHaveBeenCalled();
});
it("blocks readonly changes and stale stored drafts", async () => {
  h.raw = JSON.stringify({ base: "stale", rows: [] });
  await render();
  expect(button("storyHotspot.apply").disabled).toBe(true);
  expect(host.textContent).toContain("storyCondition.conflict");
  await act(async () => root.render(null));
  h.raw = null;
  await render(false);
  expect(button("storyHotspot.add").disabled).toBe(true);
});
it("requires confirmation before removing a hotspot", async () => {
  await render();
  await click("storyHotspot.add");
  await click("storyHotspot.remove");
  expect(JSON.parse(h.raw!).rows).toHaveLength(1);
  const actions = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  await act(async () => actions[1].onPress!());
  expect(JSON.parse(h.raw!).rows).toEqual([]);
  expect(h.apply).not.toHaveBeenCalled();
});

vi.mock("./story-hotspot-placement", () => ({ StoryHotspotPlacement: () => null }));
