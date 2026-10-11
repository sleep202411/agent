import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServiceEditorDrafts, useClearServiceEditorDraft } from "./service-editor-drafts";
import { useServiceEditorExit } from "./service-editor-exit-state";
import { ServiceEditorNavigation } from "./service-editor-navigation";
const h = vi.hoisted(() => ({
  generation: 1,
  prevent: false,
  remove: undefined as undefined | ((event: { data: { action: object } }) => void),
  dispatch: vi.fn(),
}));
vi.mock("expo-router", () => ({ useNavigation: () => ({ dispatch: h.dispatch }) }));
vi.mock("expo-router/build/react-navigation/core/usePreventRemove", () => ({
  usePreventRemove: (prevent: boolean, callback: typeof h.remove) => {
    h.prevent = prevent;
    h.remove = callback;
  },
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: ReactNode; visible: boolean }) =>
    visible ? <div>{children}</div> : null,
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
function Panel({ dirty, busy }: { dirty: boolean; busy: boolean }) {
  const clear = useClearServiceEditorDraft("details");
  useServiceEditorExit("details", dirty, busy);
  return <button onClick={clear}>clear</button>;
}
function App({
  dirty = false,
  busy = false,
  mounted = true,
}: {
  dirty?: boolean;
  busy?: boolean;
  mounted?: boolean;
}) {
  const [text, setText] = useState("kept draft");
  return (
    <ServiceEditorDrafts>
      <ServiceEditorNavigation />
      <input value={text} onChange={(e) => setText(e.target.value)} />
      {mounted && <Panel dirty={dirty} busy={busy} />}
    </ServiceEditorDrafts>
  );
}
const render = (props: Parameters<typeof App>[0]) =>
  act(async () => root.render(<App {...props} />));
const back = () => act(async () => h.remove!({ data: { action: { type: "GO_BACK" } } }));
const click = (label: string) =>
  act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  );
beforeEach(() => {
  h.generation = 1;
  h.dispatch.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("prompts only for unsaved state and keeps the mounted draft on cancellation", async () => {
  await render({});
  expect(h.prevent).toBe(false);
  await render({ dirty: true });
  expect(h.prevent).toBe(true);
  await back();
  expect(host.textContent).toContain("documentEditor.discardQuestion");
  await click("documentEditor.keepEditing");
  expect(h.dispatch).not.toHaveBeenCalled();
  expect(host.querySelector("input")?.value).toBe("kept draft");
  await back();
  await click("documentEditor.discard");
  expect(h.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "GO_BACK" });
});
it("blocks route removal while saving and permits account retirement", async () => {
  await render({ dirty: true, busy: true });
  await back();
  expect(h.dispatch).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("documentEditor.discardQuestion");
  h.generation++;
  await back();
  expect(h.dispatch).toHaveBeenCalledOnce();
});
it("preserves dirty signals across reload and clears them when drafts are saved or discarded", async () => {
  await render({ dirty: true });
  await render({ mounted: false });
  expect(h.prevent).toBe(true);
  await render({ dirty: true });
  await click("clear");
  expect(h.prevent).toBe(false);
});
