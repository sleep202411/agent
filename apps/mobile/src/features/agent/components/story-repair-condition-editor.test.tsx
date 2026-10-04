import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryRepairConditionEditor } from "./story-repair-condition-editor";
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
const render = (canEdit = true) =>
  act(async () =>
    root.render(
      <StoryRepairConditionEditor
        content={content}
        condition={undefined}
        userId="user"
        storageKey="branch"
        canEdit={canEdit}
        onApply={h.apply}
        onClose={h.close}
      />
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
it("persists comparisons and clears the editor draft only after a successful local apply", async () => {
  await render();
  await click("storyCondition.addComparison");
  expect(JSON.parse(h.raw!).compares[0].value).toBe("0");
  h.apply.mockReturnValue(false);
  await click("storyCondition.apply");
  expect(h.close).not.toHaveBeenCalled();
  expect(h.raw).not.toBe("null");
  h.apply.mockReturnValue(true);
  await click("storyCondition.apply");
  expect(h.apply).toHaveBeenLastCalledWith({
    kind: "compare",
    variableKey: "score",
    operator: "at-least",
    value: 0,
  });
  expect(h.raw).toBe("null");
  expect(h.close).toHaveBeenCalledOnce();
});
it("blocks edits and apply for read-only access", async () => {
  await render(false);
  expect(button("storyCondition.addComparison").disabled).toBe(true);
  expect(button("storyCondition.apply").disabled).toBe(true);
  expect(h.raw).toBeNull();
});
it("keeps a changed-base draft until the user explicitly discards it", async () => {
  h.raw = JSON.stringify({ base: "old", combinator: "all", negated: false, compares: [] });
  await render();
  expect(host.textContent).toContain("storyCondition.conflict");
  expect(button("storyCondition.apply").disabled).toBe(true);
  expect(h.raw).not.toBe("null");
  await click("storyCondition.reload");
  expect(h.raw).toBe("null");
  expect(button("storyCondition.apply").disabled).toBe(false);
});
it("retains malformed storage for explicit recovery instead of silently replacing it", async () => {
  h.raw = "broken";
  await render();
  expect(h.raw).toBe("broken");
  expect(button("storyCondition.apply")).toBeUndefined();
  await click("storyCondition.reload");
  expect(h.raw).toBe("null");
});
