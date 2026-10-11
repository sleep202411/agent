import { Alert } from "react-native";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryRepairVariablesEditor } from "./story-repair-variables-editor";
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
    stateVariables: [
      { key: "score", name: { "en-US": "Score" }, valueType: "number", initialValue: 0 },
    ],
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
      <StoryRepairVariablesEditor
        content={content}
        defaultLocale="en-US"
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

it("requires a default-language name for newly added variables", async () => {
  await render();
  await click("storyVariables.add");
  await click("storyVariables.apply");
  expect(host.textContent).toContain("storyVariables.nameRequired");
  expect(h.apply).not.toHaveBeenCalled();
  expect(JSON.parse(h.raw!).rows).toHaveLength(2);
});
it("preserves rejected drafts and applies valid variables", async () => {
  await render();
  h.apply.mockReturnValue(false);
  await click("storyVariables.apply");
  expect(h.close).not.toHaveBeenCalled();
  expect(host.textContent).toContain("storyCondition.applyFailed");
  h.apply.mockReturnValue(true);
  await click("storyVariables.apply");
  expect(h.apply).toHaveBeenLastCalledWith(content.storyBible.stateVariables);
  expect(h.raw).toBe("null");
});
it("retains incomplete numeric input and refuses to apply it", async () => {
  const base = JSON.stringify({
    defaultLocale: "en-US",
    variables: content.storyBible.stateVariables,
  });
  h.raw = JSON.stringify({
    base,
    rows: [{ ...content.storyBible.stateVariables[0], initialValue: "-" }],
  });
  await render();
  await click("storyVariables.apply");
  expect(host.textContent).toContain("storyCondition.invalidValue");
  expect(h.apply).not.toHaveBeenCalled();
  expect(JSON.parse(h.raw!).rows[0].initialValue).toBe("-");
});
it("blocks read-only editing and stale definitions", async () => {
  await render(false);
  expect(button("storyVariables.add").disabled).toBe(true);
  expect(button("storyVariables.apply").disabled).toBe(true);
});
it("confirms removal before changing the variable list", async () => {
  await render();
  await click("Score");
  await click("storyVariables.remove");
  expect(h.raw).toBeNull();
  const buttons = vi.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  await act(async () => buttons[1].onPress!());
  expect(JSON.parse(h.raw!).rows).toEqual([]);
  expect(h.apply).not.toHaveBeenCalled();
});
it("retains stale stored edits until explicit reload", async () => {
  h.raw = JSON.stringify({ base: "old", rows: [] });
  await render();
  expect(button("storyVariables.apply").disabled).toBe(true);
  await click("storyCondition.reload");
  expect(h.raw).toBe("null");
  expect(button("storyVariables.apply").disabled).toBe(false);
});
