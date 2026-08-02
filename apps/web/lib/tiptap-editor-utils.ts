import { NodeSelection, type Selection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { Editor } from "@tiptap/react";
import { isNodeSelection, isTextSelection, posToDOMRect } from "@tiptap/react";

const NODE_TYPE_LABELS: Record<string, string> = {
  paragraph: "Text",
  heading: "Heading",
  blockquote: "Blockquote",
  listItem: "List Item",
  taskItem: "To-do Item",
  codeBlock: "Code Block",
  table: "Table",
  tableCell: "Table Cell",
  tableHeader: "Table Header",
};

export type OverflowPosition = "none" | "top" | "bottom" | "both";

export function getNodeDisplayName(editor: Editor | null): string {
  if (!editor) return "Node";

  const { selection } = editor.state;
  if (selection instanceof NodeSelection) {
    const type = selection.node.type.name;
    return NODE_TYPE_LABELS[type] || type.toLowerCase();
  }
  if (selection instanceof CellSelection) return "Table";

  const type = selection.$anchor.parent.type.name;
  return NODE_TYPE_LABELS[type] || type.toLowerCase();
}

export function getElementOverflowPosition(
  targetElement: Element,
  containerElement: HTMLElement
): OverflowPosition {
  const targetBounds = targetElement.getBoundingClientRect();
  const containerBounds = containerElement.getBoundingClientRect();
  const overTop = targetBounds.top < containerBounds.top;
  const overBottom = targetBounds.bottom > containerBounds.bottom;

  if (overTop && overBottom) return "both";
  if (overTop) return "top";
  if (overBottom) return "bottom";
  return "none";
}

export function isSelectionValid(
  editor: Editor | null,
  selection?: Selection,
  excludedNodeTypes: string[] = ["imageUpload", "horizontalRule"]
): boolean {
  if (!editor) return false;
  const current = selection ?? editor.state.selection;
  const { doc } = editor.state;
  const { empty, from, to } = current;
  const emptyTextBlock = !doc.textBetween(from, to).length && isTextSelection(current);
  const codeBlock =
    current.$from.parent.type.spec.code ||
    (isNodeSelection(current) && current.node.type.spec.code);
  const excluded = isNodeSelection(current) && excludedNodeTypes.includes(current.node.type.name);

  return (
    !empty && !emptyTextBlock && !codeBlock && !excluded && !(current instanceof CellSelection)
  );
}

export function isTextSelectionValid(editor: Editor | null): boolean {
  if (!editor) return false;
  const { selection } = editor.state;
  return (
    isTextSelection(selection) &&
    !selection.empty &&
    !selection.$from.parent.type.spec.code &&
    !isNodeSelection(selection)
  );
}

export function getSelectionBoundingRect(editor: Editor): DOMRect | null {
  const { selection } = editor.view.state;
  const from = Math.min(...selection.ranges.map((range) => range.$from.pos));
  const to = Math.max(...selection.ranges.map((range) => range.$to.pos));

  if (isNodeSelection(selection)) {
    const node = editor.view.nodeDOM(from);
    if (node instanceof HTMLElement) return node.getBoundingClientRect();
  }

  return posToDOMRect(editor.view, from, to);
}
