import { Alert } from "react-native";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryRepairEffectsEditor } from "./story-repair-effects-editor";
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
const content = {
  storyBible: {
    stateVariables: [{ key: "score", valueType: "number", name: { "en-US": "Score" } }],
  },
  graph: { entryNodeId: null, nodes: [] },
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
const render = (canEdit = true, applyError?: string) =>
  act(async () =>
    root.render(
      <StoryRepairEffectsEditor
        content={content}
        effects={[]}
        userId="user"
        storageKey="branch"
        canEdit={canEdit}
        applyError={applyError}
        onApply={h.apply}
        onClose={h.close}
      />
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());

it("keeps a rejected effects draft and applies it only after success", async () => {
  await render();
  await click("storyEffects.addEffect");
  expect(JSON.parse(h.raw!).rows[0].value).toBe("0");
  h.apply.mockReturnValue(false);
  await click("storyEffects.apply");
  expect(h.close).not.toHaveBeenCalled();
  expect(h.raw).not.toBe("null");
  expect(host.textContent).toContain("storyCondition.applyFailed");
  h.apply.mockReturnValue(true);
  await click("storyEffects.apply");
  expect(h.apply).toHaveBeenLastCalledWith([{ kind: "set", key: "score", value: 0 }]);
  expect(h.raw).toBe("null");
});
it("restores unfinished numeric input without applying it", async () => {
  h.raw = JSON.stringify({ base: "[]", rows: [{ key: "score", kind: "subtract", value: "-" }] });
  await render();
  await click("storyEffects.apply");
  expect(host.textContent).toContain("storyCondition.invalidValue");
  expect(h.apply).not.toHaveBeenCalled();
  expect(JSON.parse(h.raw!).rows[0].value).toBe("-");
});
it("applies subtraction as an ordered negative add effect", async () => {
  h.raw = JSON.stringify({
    base: "[]",
    rows: [
      { key: "score", kind: "subtract", value: "2.5" },
      { key: "score", kind: "set", value: "1" },
    ],
  });
  await render();
  await click("storyEffects.apply");
  expect(h.apply).toHaveBeenLastCalledWith([
    { kind: "add", key: "score", amount: -2.5 },
    { kind: "set", key: "score", value: 1 },
  ]);
});
it("blocks read-only editing", async () => {
  await render(false);
  expect(button("storyEffects.addEffect").disabled).toBe(true);
  expect(button("storyEffects.apply").disabled).toBe(true);
});
it("retains a changed-base draft for explicit discard", async () => {
  h.raw = JSON.stringify({ base: "old", rows: [] });
  await render();
  expect(button("storyEffects.apply").disabled).toBe(true);
  await click("storyCondition.reload");
  expect(h.raw).toBe("null");
});
it("enforces six effects without discarding malformed stored edits", async () => {
  h.raw = JSON.stringify({
    base: "[]",
    rows: Array(6).fill({ key: "score", kind: "set", value: "0" }),
  });
  await render();
  expect(button("storyEffects.addEffect").disabled).toBe(true);
});

it("keeps corrupt edits until confirmed clearing, without applying automatically", async () => {
  h.raw = "broken";
  await render();
  expect(h.raw).toBe("broken");
  await click("storyEffects.clear");
  const buttons = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  await act(async () => buttons[1].onPress!());
  expect(JSON.parse(h.raw!).rows).toEqual([]);
  expect(h.apply).not.toHaveBeenCalled();
  await click("storyEffects.apply");
  expect(h.apply).toHaveBeenCalledWith([]);
});
