import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryRepairPriceEditor } from "./story-repair-price-editor";
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

const storage = { raw: null as string | null };
vi.mock("@/lib/durable-record", () => ({
  durableRecord: () => ({
    read: () => storage.raw,
    write: (v: string) => {
      storage.raw = v;
    },
  }),
}));
const content = {
  storyBible: {},
  graph: { entryNodeId: "a", nodes: [{ kind: "clip", nodeId: "a", communityPointPrice: 5 }] },
};
let host: HTMLDivElement, root: Root;
const apply = vi.fn(),
  close = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  vi.resetAllMocks();
  storage.raw = null;
  apply.mockReturnValue(true);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = (canEdit = true) =>
  act(async () =>
    root.render(
      <StoryRepairPriceEditor
        content={content}
        nodeId="a"
        userId="user"
        storageKey="scene"
        canEdit={canEdit}
        onApply={apply}
        onClose={close}
      />
    )
  );
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
const click = (label: string) => act(async () => button(label).click());
it("retains rejected price drafts until the parent accepts them", async () => {
  storage.raw = JSON.stringify({ base: 5, value: "12" });
  await render();
  apply.mockReturnValue(false);
  await click("storyPrice.apply");
  expect(apply).toHaveBeenCalledWith(5, 12);
  expect(close).not.toHaveBeenCalled();
  expect(storage.raw).toContain('"12"');
  expect(host.textContent).toContain("storyCondition.applyFailed");
  apply.mockReturnValue(true);
  await click("storyPrice.apply");
  expect(storage.raw).toBe("null");
  expect(close).toHaveBeenCalledOnce();
});
it("keeps incomplete numbers and rejects them without applying", async () => {
  storage.raw = JSON.stringify({ base: 5, value: "-" });
  await render();
  await click("storyPrice.apply");
  expect(apply).not.toHaveBeenCalled();
  expect(host.textContent).toContain("storyPrice.invalid");
  expect(storage.raw).toContain('"-"');
});
it("blocks stale and read-only price edits", async () => {
  storage.raw = JSON.stringify({ base: 4, value: "12" });
  await render();
  expect(button("storyPrice.apply").disabled).toBe(true);
  expect(host.textContent).toContain("storyCondition.conflict");
  await click("storyCondition.reload");
  expect(JSON.parse(storage.raw!)).toEqual({ base: 5, value: "5" });
  await render(false);
  expect(button("storyPrice.apply").disabled).toBe(true);
});
