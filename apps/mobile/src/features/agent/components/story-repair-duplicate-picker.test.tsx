import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryRepairDuplicatePicker } from "./story-repair-duplicate-picker";
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TextInput: ({ value }: { value: string }) => <input value={value} readOnly />,
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
  storyBible: {},
  graph: {
    entryNodeId: "a",
    nodes: [
      {
        kind: "clip",
        nodeId: "a",
        name: "Opening",
        exit: { kind: "choice", decisionId: "d", prompt: { "en-US": "Choose" }, choices: [] },
      },
      { kind: "clip", nodeId: "b", name: "Next scene", exit: { kind: "auto", routes: [] } },
    ],
  },
};
let host: HTMLDivElement, root: Root;
const apply = vi.fn(),
  close = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  apply.mockReturnValue(true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = (canEdit = true, initialNodeId = "a") =>
  act(async () =>
    root.render(
      <StoryRepairDuplicatePicker
        content={content}
        initialNodeId={initialNodeId}
        canEdit={canEdit}
        onApply={apply}
        onClose={close}
      />
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
it("retains the selection and keeps the picker open after a rejected durable write", async () => {
  await render();
  await click("○ Next scene");
  apply.mockReturnValue(false);
  await click("storyDuplicate.apply");
  expect(apply).toHaveBeenLastCalledWith([
    { nodeId: "a", role: "node" },
    { nodeId: "b", role: "node" },
  ]);
  expect(close).not.toHaveBeenCalled();
  expect(host.textContent).toContain("storyCondition.applyFailed");
  apply.mockReturnValue(true);
  await click("storyDuplicate.apply");
  expect(close).toHaveBeenCalledOnce();
});
it("supports copying only a legacy attached choice", async () => {
  await render();
  await click("● Opening");
  await click("○ Opening · storyDuplicate.attachedChoice");
  await click("storyDuplicate.apply");
  expect(apply).toHaveBeenCalledWith([{ nodeId: "a", role: "choice-exit" }]);
});
it("prevents empty and read-only duplication", async () => {
  await render(true, "missing");
  expect(button("storyDuplicate.apply").disabled).toBe(true);
  await render(false);
  await click("○ Opening");
  await click("storyDuplicate.apply");
  expect(apply).not.toHaveBeenCalled();
  expect(button("○ Opening").disabled).toBe(true);
});
