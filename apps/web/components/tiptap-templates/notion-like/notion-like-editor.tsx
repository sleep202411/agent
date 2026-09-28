"use client";

import { useContext, useEffect, useMemo, useRef, type ReactNode, type FocusEvent } from "react";
import type { JSONContent } from "@tiptap/core";
import { Emoji, gitHubEmojis } from "@tiptap/extension-emoji";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder, Selection } from "@tiptap/extensions";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Typography } from "@tiptap/extension-typography";
import { UniqueID } from "@tiptap/extension-unique-id";
import { EditorContent, EditorContext, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { createPortal } from "react-dom";

import { Indent } from "@/components/tiptap-extension/indent-extension";
import { ListNormalizationExtension } from "@/components/tiptap-extension/list-normalization-extension";
import { NodeAlignment } from "@/components/tiptap-extension/node-alignment-extension";
import { NodeBackground } from "@/components/tiptap-extension/node-background-extension";
import { TripleClickBlockSelection } from "@/components/tiptap-extension/triple-click-block-selection-extension";
import { UiState } from "@/components/tiptap-extension/ui-state-extension";
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension";
import { TableKit } from "@/components/tiptap-node/table-node/extensions/table-node-extension";
import { TableHandleExtension } from "@/components/tiptap-node/table-node/extensions/table-handle";
import { TableCellHandleMenu } from "@/components/tiptap-node/table-node/ui/table-cell-handle-menu";
import { TableExtendRowColumnButtons } from "@/components/tiptap-node/table-node/ui/table-extend-row-column-button";
import { TableHandle } from "@/components/tiptap-node/table-node/ui/table-handle/table-handle";
import {
  TableSelectionOverlay,
  type TableSelectionOverlayProps,
} from "@/components/tiptap-node/table-node/ui/table-selection-overlay";
import { DragContextMenu } from "@/components/tiptap-ui/drag-context-menu";
import type { DragContextMenuLabels } from "@/components/tiptap-ui/drag-context-menu/drag-context-menu-types";
import { EmojiDropdownMenu } from "@/components/tiptap-ui/emoji-dropdown-menu";
import { SlashDropdownMenu } from "@/components/tiptap-ui/slash-dropdown-menu";
import type { SlashMenuConfig } from "@/components/tiptap-ui/slash-dropdown-menu/use-slash-dropdown-menu";
import { useScrollToHash } from "@/components/tiptap-ui/copy-anchor-link-button/use-scroll-to-hash";
import { useUiEditorState } from "@/hooks/use-ui-editor-state";

import { MobileToolbar } from "./notion-like-editor-mobile-toolbar";
import { NotionToolbarFloating } from "./notion-like-editor-toolbar-floating";

import "@/components/tiptap-node/blockquote-node/blockquote-node.scss";
import "@/components/tiptap-node/code-block-node/code-block-node.scss";
import "@/components/tiptap-node/heading-node/heading-node.scss";
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss";
import "@/components/tiptap-node/list-node/list-node.scss";
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss";
import "@/components/tiptap-node/table-node/styles/prosemirror-table.scss";
import "@/components/tiptap-node/table-node/styles/table-node.scss";
import "./notion-like-editor.scss";

const UNIQUE_ID_NODE_TYPES = [
  "table",
  "paragraph",
  "bulletList",
  "orderedList",
  "taskList",
  "heading",
  "blockquote",
  "codeBlock",
] as const;

const SLASH_MENU_ITEMS: NonNullable<SlashMenuConfig["enabledItems"]> = [
  "text",
  "heading_1",
  "heading_2",
  "heading_3",
  "bullet_list",
  "ordered_list",
  "task_list",
  "quote",
  "code_block",
  "emoji",
  "table",
  "divider",
];

const NotionTableCellMenu: NonNullable<TableSelectionOverlayProps["cellMenu"]> = (props) => (
  <TableCellHandleMenu
    editor={props.editor}
    onMouseDown={(event) => props.onResizeStart?.("br")(event)}
  />
);

export interface NotionEditorProps {
  content: JSONContent;
  editable: boolean;
  placeholder: string;
  ariaLabel: string;
  onUpdate: (document: JSONContent) => void;
  onBlur: () => void;
  onReady?: (editor: Editor) => void;
  renderToolbar?: (editor: Editor) => ReactNode;
  slashMenuFilterPlaceholder: string;
  slashMenuLabels: NonNullable<SlashMenuConfig["labels"]>;
  dragMenuLabels: DragContextMenuLabels;
}

function NotionEditorContent({
  slashMenuConfig,
  dragMenuLabels,
}: {
  slashMenuConfig: SlashMenuConfig;
  dragMenuLabels: DragContextMenuLabels;
}) {
  const { editor } = useContext(EditorContext)!;
  const { isDragging } = useUiEditorState(editor);

  useScrollToHash();

  if (!editor) return null;

  return (
    <EditorContent
      editor={editor}
      className="notion-like-editor-content"
      style={{ cursor: isDragging ? "grabbing" : "auto" }}
    >
      <DragContextMenu labels={dragMenuLabels} />
      <EmojiDropdownMenu />
      <SlashDropdownMenu config={slashMenuConfig} />
      <NotionToolbarFloating />
      {createPortal(<MobileToolbar />, document.body)}
    </EditorContent>
  );
}

/**
 * Official Tiptap Notion-like UI adapted to FizzDragon's versioned document
 * persistence. Assisted authoring and collaboration remain product-owned
 * capabilities and are not part of this editor surface.
 */
export function NotionEditor({
  content,
  editable,
  placeholder,
  ariaLabel,
  onUpdate,
  onBlur,
  onReady,
  renderToolbar,
  slashMenuFilterPlaceholder,
  slashMenuLabels,
  dragMenuLabels,
}: NotionEditorProps) {
  const callbacks = useRef({ onUpdate, onBlur, onReady });

  useEffect(() => {
    callbacks.current = { onUpdate, onBlur, onReady };
  }, [onBlur, onReady, onUpdate]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        horizontalRule: false,
        dropcursor: { width: 2 },
        link: {
          openOnClick: false,
          HTMLAttributes: {
            rel: "noopener noreferrer nofollow",
            target: "_blank",
          },
        },
      }),
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({
        placeholder,
        emptyNodeClass: "is-empty with-slash",
      }),
      Emoji.configure({
        emojis: gitHubEmojis.filter((emoji) => !emoji.name.includes("regional")),
        forceFallbackImages: false,
      }),
      TableKit.configure({
        table: { resizable: true, cellMinWidth: 120 },
      }),
      NodeBackground.configure({
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "taskList",
          "bulletList",
          "orderedList",
          "tableCell",
          "tableHeader",
        ],
      }),
      NodeAlignment,
      TextStyle,
      Superscript,
      Subscript,
      Indent,
      Color,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Selection,
      UniqueID.configure({
        types: [...UNIQUE_ID_NODE_TYPES],
        updateDocument: editable,
      }),
      Typography,
      UiState,
      TableHandleExtension,
      ListNormalizationExtension,
      TripleClickBlockSelection,
    ],
    [editable, placeholder]
  );

  const slashMenuConfig = useMemo<SlashMenuConfig>(
    () => ({
      enabledItems: SLASH_MENU_ITEMS,
      labels: slashMenuLabels,
      decorationContent: slashMenuFilterPlaceholder,
    }),
    [slashMenuFilterPlaceholder, slashMenuLabels]
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    content,
    extensions,
    editorProps: {
      attributes: {
        class: "notion-like-editor",
        role: "textbox",
        "aria-label": ariaLabel,
        "aria-multiline": "true",
        "aria-readonly": editable ? "false" : "true",
      },
    },
    onCreate: ({ editor: instance }) => callbacks.current.onReady?.(instance),
    onUpdate: ({ editor: instance, transaction }) => {
      if (!transaction.docChanged || instance.view.composing) return;
      callbacks.current.onUpdate(instance.getJSON());
    },
    onBlur: () => callbacks.current.onBlur(),
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const incoming = JSON.stringify(content);
    if (JSON.stringify(editor.getJSON()) === incoming) return;
    editor.commands.setContent(content, {
      emitUpdate: false,
      errorOnInvalidContent: true,
    });
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div
      className="notion-like-editor-wrapper"
      onBlurCapture={(event: FocusEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        callbacks.current.onBlur();
      }}
    >
      <EditorContext.Provider value={{ editor }}>
        {editable ? renderToolbar?.(editor) : null}
        <div className="notion-like-editor-layout">
          <NotionEditorContent slashMenuConfig={slashMenuConfig} dragMenuLabels={dragMenuLabels} />
        </div>
        <TableExtendRowColumnButtons />
        <TableHandle />
        <TableSelectionOverlay showResizeHandles cellMenu={NotionTableCellMenu} />
      </EditorContext.Provider>
    </div>
  );
}
