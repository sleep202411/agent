import type { DragHandleProps } from "@tiptap/extension-drag-handle-react";
import type { Node } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

export interface DragContextMenuLabels {
  insertBlock: string;
  blockOptions: string;
  clickForOptions: string;
  holdForDrag: string;
  block: string;
  paragraph: string;
  heading1: string;
  heading2: string;
  heading3: string;
  bulletList: string;
  orderedList: string;
  taskList: string;
  blockquote: string;
  codeBlock: string;
  turnInto: string;
  resetFormatting: string;
  fitTableToWidth: string;
  clearContents: string;
  color: string;
  duplicate: string;
  copy: string;
  copyLink: string;
  delete: string;
}

export interface DragContextMenuProps extends Omit<DragHandleProps, "editor" | "children"> {
  editor?: Editor | null;
  withSlashCommandTrigger?: boolean;
  mobileBreakpoint?: number;
  labels: DragContextMenuLabels;
}

export interface NodeChangeData {
  node: Node | null;
  editor: Editor;
  pos: number;
}

export interface MenuItemProps {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  isActive?: boolean;
  shortcutBadge?: React.ReactNode;
}
export interface ColorMenuItemProps {
  color: { value: string; label: string };
}
