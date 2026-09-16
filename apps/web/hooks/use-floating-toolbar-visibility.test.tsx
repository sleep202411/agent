import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { Schema } from "@tiptap/pm/model";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useFloatingToolbarVisibility,
  HIDE_FLOATING_META,
} from "./use-floating-toolbar-visibility";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    image: { group: "block", atom: true },
  },
});
function fixture() {
  const callbacks = new Map<string, (...args: unknown[]) => void>();
  const editor = {
    state: { selection: NodeSelection.create(schema.node("doc", null, [schema.node("image")]), 0) },
    view: { dom: document.createElement("div") },
    on: vi.fn((event, fn) => callbacks.set(event, fn)),
    off: vi.fn((event) => callbacks.delete(event)),
  } as unknown as Editor;
  return { editor, callbacks };
}
const valid = () => true;
function Probe({ editor }: { editor: Editor | null }) {
  const { shouldShow } = useFloatingToolbarVisibility({ editor, isSelectionValid: valid });
  return <span>{String(shouldShow)}</span>;
}
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("does not retain visibility after the editor is removed", async () => {
  const first = fixture();
  await act(async () => root.render(<Probe editor={first.editor} />));
  expect(host.textContent).toBe("true");
  await act(async () => root.render(<Probe editor={null} />));
  expect(host.textContent).toBe("false");
  expect(first.callbacks.size).toBe(0);
});
it("does not carry a hidden node selection into a replacement editor", async () => {
  const first = fixture(),
    second = fixture();
  await act(async () => root.render(<Probe editor={first.editor} />));
  act(() =>
    first.callbacks.get("transaction")!({
      transaction: { getMeta: (key: string) => key === HIDE_FLOATING_META },
    })
  );
  expect(host.textContent).toBe("false");
  await act(async () => root.render(<Probe editor={second.editor} />));
  expect(host.textContent).toBe("true");
  expect(first.callbacks.size).toBe(0);
});
