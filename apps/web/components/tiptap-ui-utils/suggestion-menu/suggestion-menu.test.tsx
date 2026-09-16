import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ suggestion: vi.fn(), floating: vi.fn() }));
vi.mock("@tiptap/suggestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tiptap/suggestion")>()),
  Suggestion: (options: unknown) => {
    h.suggestion(options);
    return {};
  },
}));
vi.mock("@/hooks/use-tiptap-editor", () => ({
  useTiptapEditor: (editor: unknown) => ({ editor }),
}));
vi.mock("@/hooks/use-floating-element", () => ({
  useFloatingElement: (show: boolean, _reference: unknown, _z: number, options: unknown) => {
    h.floating(options);
    return { ref: () => {}, style: {}, getFloatingProps: () => ({}), isMounted: show };
  },
}));
import { SuggestionMenu } from "./suggestion-menu";
let root: Root, host: HTMLDivElement, dom: HTMLDivElement, editor: Editor;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.suggestion.mockClear();
  h.floating.mockClear();
  host = document.createElement("div");
  dom = document.createElement("div");
  document.body.append(host, dom);
  root = createRoot(host);
  editor = {
    isDestroyed: false,
    state: { plugins: [] },
    extensionManager: { extensions: [] },
    view: { dom },
    registerPlugin: vi.fn(),
    unregisterPlugin: vi.fn(),
  } as unknown as Editor;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dom.remove();
});
it("releases editor keys after floating dismissal and admits a new suggestion session", async () => {
  await act(async () =>
    root.render(<SuggestionMenu editor={editor}>{() => <span>result</span>}</SuggestionMenu>)
  );
  const handlers = h.suggestion.mock.calls[0]![0].render();
  const command = vi.fn();
  const item = { title: "First", onSelect: vi.fn() };
  const props = {
    items: [item],
    query: "",
    range: { from: 0, to: 1 },
    command,
    decorationNode: dom,
  };
  await act(async () => handlers.onStart(props));
  expect(host.textContent).toBe("result");
  await act(async () => h.floating.mock.calls.at(-1)![0].onOpenChange(false));
  expect(host.textContent).toBe("");
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  act(() => dom.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(false);
  expect(command).not.toHaveBeenCalled();
  await act(async () => handlers.onStart(props));
  act(() =>
    dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    )
  );
  expect(command).toHaveBeenCalledExactlyOnceWith(item);
});
it("does not close the suggestion plugin during input-method composition", async () => {
  await act(async () =>
    root.render(<SuggestionMenu editor={editor}>{() => <span>result</span>}</SuggestionMenu>)
  );
  const handlers = h.suggestion.mock.calls[0]![0].render();
  await act(async () =>
    handlers.onStart({
      items: [],
      query: "",
      range: { from: 0, to: 1 },
      command: vi.fn(),
      decorationNode: dom,
    })
  );
  let handled: unknown;
  act(() => {
    handled = handlers.onKeyDown({
      event: new KeyboardEvent("keydown", { key: "Escape", isComposing: true }),
    });
  });
  expect(handled).toBe(false);
  expect(host.textContent).toBe("result");
});
