// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductionOverviewToolbar } from "./production-overview-toolbar";
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
let editor: Editor;
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit, TaskList, TaskItem],
    content: "<p>Production brief</p>",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ProductionOverviewToolbar editor={editor} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  container.remove();
});
async function click(key: string) {
  await act(async () => {
    (container.querySelector(`[aria-label="formatting.${key}"]`) as HTMLButtonElement).click();
  });
}
it("formats selected text and supports undo/redo", async () => {
  await act(async () => {
    editor.commands.selectAll();
  });
  await click("bold");
  expect(editor.getHTML()).toContain("<strong>Production brief</strong>");
  expect(
    container.querySelector('[aria-label="formatting.bold"]')?.getAttribute("aria-pressed")
  ).toBe("true");
  await click("undo");
  expect(editor.getHTML()).not.toContain("<strong>");
  await click("redo");
  expect(editor.getHTML()).toContain("<strong>");
});
it.each([
  ["heading", "heading"],
  ["bulletList", "bulletList"],
  ["orderedList", "orderedList"],
  ["checklist", "taskList"],
  ["quote", "blockquote"],
])("creates %s blocks", async (key, type) => {
  await click(key);
  expect(editor.getJSON().content?.[0]?.type).toBe(type);
});
it("hides controls for a read-only document", async () => {
  await act(async () => {
    editor.setEditable(false);
  });
  expect(container.querySelector("button")).toBeNull();
});
