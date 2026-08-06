"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  mergeAttributes,
  Node,
  nodePasteRule,
  type Editor,
  type JSONContent,
  type Range,
} from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type NodeViewProps,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, {
  exitSuggestion,
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { AssetSelectDialog } from "@/components/canvas/authoring/asset-select-dialog";
import { MentionChip, MentionMenu, type MentionItem } from "@/lib/prompt-mentions";
import {
  PROMPT_MENTION_NODE_NAME,
  promptDocumentToText,
  promptMentionParts,
  promptTextToDocument,
} from "@/lib/prompt-document";
import { cn } from "@/lib/utils";

const EMPTY_MENTIONS: readonly MentionItem[] = [];

type PromptEditorContextValue = {
  editable: boolean;
  mentions: readonly MentionItem[];
};

const PromptEditorContext = createContext<PromptEditorContextValue>({
  editable: false,
  mentions: EMPTY_MENTIONS,
});

type MentionMenuState = {
  active: number;
  suggestion: SuggestionProps<MentionItem>;
};

type AssetPickerSession = {
  editor: Editor;
  range: Range;
};

type AssetPickerHandle = {
  enabled: boolean;
  open: (session: AssetPickerSession) => void;
  isOpen: () => boolean;
  updateRange: (range: Range) => void;
};

type PromptMentionNodeOptions = {
  setMenu: (state: MentionMenuState | null) => void;
};

type PromptMentionNodeStorage = {
  mentions: readonly MentionItem[];
  placeholder: string;
  /** Project `@` picker — null when the surface has no project inventory. */
  assetPicker: AssetPickerHandle | null;
};

declare module "@tiptap/core" {
  interface Storage {
    promptMention: PromptMentionNodeStorage;
  }

  interface Commands<ReturnType> {
    updatePromptMentionRuntime: {
      updatePromptMentionRuntime: (runtime: Partial<PromptMentionNodeStorage>) => ReturnType;
    };
  }
}

function itemAttributes(item: MentionItem) {
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    name: item.name ?? "",
    previewUrl: item.previewUrl ?? "",
  };
}

function mentionFromNode(node: NodeViewProps["node"]): MentionItem {
  const kind = node.attrs.kind;
  return {
    id: String(node.attrs.id ?? ""),
    kind: kind === "video" || kind === "audio" ? kind : "image",
    label: String(node.attrs.label ?? ""),
    name: String(node.attrs.name ?? "") || undefined,
    previewUrl: String(node.attrs.previewUrl ?? "") || undefined,
  };
}

function mentionDeletionRange(editor: Editor, from: number, nodeSize: number): Range {
  const { doc } = editor.state;
  let start = from;
  let end = from + nodeSize;
  const $start = doc.resolve(start);
  const $end = doc.resolve(end);
  const leftText = $start.nodeBefore?.isText ? ($start.nodeBefore.text ?? "") : "";
  const rightText = $end.nodeAfter?.isText ? ($end.nodeAfter.text ?? "") : "";
  const hasLeftSeparator = /[ \t]$/.test(leftText);
  const hasRightSeparator = /^[ \t]/.test(rightText);
  const atBlockStart = $start.parentOffset === 0;
  const atBlockEnd = $end.parentOffset === $end.parent.content.size;

  if (hasRightSeparator) {
    const afterOne = doc.resolve(end + 1);
    const rightSeparatorEndsBlock = afterOne.parentOffset === afterOne.parent.content.size;
    if (hasLeftSeparator || atBlockStart || rightSeparatorEndsBlock) end += 1;
    if (hasLeftSeparator && rightSeparatorEndsBlock) start -= 1;
  } else if (hasLeftSeparator) {
    const rightNode = $end.nodeAfter;
    const rightCharacter = rightNode?.isText ? (rightNode.text?.[0] ?? "") : "";
    const followedByPunctuation =
      rightNode?.type.name === "hardBreak" ||
      /^[,.;:!?，。！？、；：)\]）'\"”]/.test(rightCharacter);
    if (atBlockEnd || followedByPunctuation) start -= 1;
  }

  return { from: start, to: end };
}

function deleteMentionAt(editor: Editor, from: number, nodeSize: number): boolean {
  if (!editor.isEditable) return false;
  return editor.commands.deleteRange(mentionDeletionRange(editor, from, nodeSize));
}

function deleteAdjacentMention(editor: Editor, direction: "backward" | "forward"): boolean {
  const { doc, selection } = editor.state;
  const selectedNode = (selection as typeof selection & { node?: NodeViewProps["node"] }).node;
  if (selectedNode?.type.name === PROMPT_MENTION_NODE_NAME) {
    return deleteMentionAt(editor, selection.from, selectedNode.nodeSize);
  }
  if (!selection.empty) return false;

  if (direction === "forward") {
    const after = selection.$from.nodeAfter;
    return after?.type.name === PROMPT_MENTION_NODE_NAME
      ? deleteMentionAt(editor, selection.from, after.nodeSize)
      : false;
  }

  const before = selection.$from.nodeBefore;
  if (before?.type.name === PROMPT_MENTION_NODE_NAME) {
    return deleteMentionAt(editor, selection.from - before.nodeSize, before.nodeSize);
  }
  if (!before?.isText || !/[ \t]$/.test(before.text ?? "")) return false;

  const beforeSeparator = doc.resolve(selection.from - 1).nodeBefore;
  return beforeSeparator?.type.name === PROMPT_MENTION_NODE_NAME
    ? deleteMentionAt(
        editor,
        selection.from - 1 - beforeSeparator.nodeSize,
        beforeSeparator.nodeSize
      )
    : false;
}

function mentionInsertion(editor: Editor, range: Range, item: MentionItem) {
  const { doc } = editor.state;
  const textAfter = doc.resolve(range.to).nodeAfter;
  const horizontalWhitespace = textAfter?.isText
    ? (textAfter.text?.match(/^[ \t]+/)?.[0].length ?? 0)
    : 0;
  const replaceTo = range.to + horizontalWhitespace;
  const $after = doc.resolve(replaceTo);
  const nextNode = $after.nodeAfter;
  const nextCharacter = nextNode?.isText ? (nextNode.text?.[0] ?? "") : "";
  const atBlockEnd = $after.parentOffset === $after.parent.content.size;
  const atDocumentEnd = replaceTo === doc.content.size - 1;
  const followedByPunctuation =
    nextNode?.type.name === "hardBreak" || /^[,.;:!?，。！？、；：)\]）'\"”]/.test(nextCharacter);
  const needsSeparator = atDocumentEnd || (!atBlockEnd && !!nextNode && !followedByPunctuation);
  const content: JSONContent[] = [{ type: PROMPT_MENTION_NODE_NAME, attrs: itemAttributes(item) }];
  if (needsSeparator) content.push({ type: "text", text: " " });
  editor.chain().focus().insertContentAt({ from: range.from, to: replaceTo }, content).run();
}

function PromptMentionNodeView({ editor, getPos, node }: NodeViewProps) {
  const { editable, mentions } = useContext(PromptEditorContext);
  const storedMention = mentionFromNode(node);
  const liveMention = mentions.find((item) => item.id === storedMention.id);
  const mention = liveMention
    ? {
        ...liveMention,
        // The label is the persisted wire token. Keep it stable until a
        // blurred canonicalization safely rebuilds the document.
        label: storedMention.label,
      }
    : storedMention;
  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      data-prompt-mention=""
      className="inline align-baseline"
    >
      <MentionChip
        mention={mention}
        text={`@${mention.label}`}
        onRemove={
          editable
            ? () => {
                const position = getPos();
                if (typeof position !== "number") return;
                if (deleteMentionAt(editor, position, node.nodeSize)) {
                  requestAnimationFrame(() => editor.commands.focus());
                }
              }
            : undefined
        }
      />
    </NodeViewWrapper>
  );
}

const PromptMentionNode = Node.create<PromptMentionNodeOptions, PromptMentionNodeStorage>({
  name: PROMPT_MENTION_NODE_NAME,
  // Run mention-aware Backspace/Delete before StarterKit's generic keymap so
  // separator cleanup cannot be bypassed by the default atom deletion.
  priority: 1000,
  group: "inline",
  inline: true,
  atom: true,

  addOptions() {
    return {
      setMenu: () => undefined,
    };
  },

  addStorage() {
    return {
      mentions: EMPTY_MENTIONS,
      placeholder: "",
      assetPicker: null,
    };
  },

  addCommands() {
    return {
      updatePromptMentionRuntime: (runtime) => () => {
        if (runtime.mentions !== undefined) this.storage.mentions = runtime.mentions;
        if (runtime.placeholder !== undefined) this.storage.placeholder = runtime.placeholder;
        if (runtime.assetPicker !== undefined) this.storage.assetPicker = runtime.assetPicker;
        return true;
      },
    };
  },

  addAttributes() {
    return {
      id: { default: "", rendered: false },
      kind: { default: "image", rendered: false },
      label: { default: "", rendered: false },
      name: { default: "", rendered: false },
      previewUrl: { default: "", rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-prompt-mention]",
        getAttrs: (node) => {
          const element = node as HTMLElement;
          return {
            id: element.dataset.referenceId ?? "",
            kind: element.dataset.kind ?? "image",
            label: element.dataset.label ?? "",
            name: element.dataset.name ?? "",
            previewUrl: element.dataset.previewUrl ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-prompt-mention": "",
        "data-reference-id": node.attrs.id,
        "data-kind": node.attrs.kind,
        "data-label": node.attrs.label,
        "data-name": node.attrs.name,
        "data-preview-url": node.attrs.previewUrl,
      }),
      `@${node.attrs.label}`,
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.label}`;
  },

  addNodeView() {
    return ReactNodeViewRenderer(PromptMentionNodeView, { as: "span" });
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => deleteAdjacentMention(this.editor, "backward"),
      Delete: () => deleteAdjacentMention(this.editor, "forward"),
    };
  },

  addPasteRules() {
    const { storage } = this;
    return [
      nodePasteRule({
        find: (text) =>
          promptMentionParts(text, storage.mentions).flatMap((part) =>
            part.mention
              ? [
                  {
                    index: part.start,
                    text: part.text,
                    data: { mention: part.mention },
                  },
                ]
              : []
          ),
        type: this.type,
        getAttributes: (match) => {
          const mention = match.data?.mention as MentionItem | undefined;
          return mention ? itemAttributes(mention) : false;
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const { setMenu } = this.options;
    const { storage } = this;
    return [
      Suggestion<MentionItem>({
        editor: this.editor,
        char: "@",
        allowSpaces: false,
        // Prompts commonly place a reference directly after Chinese text or
        // another mention, so the default whitespace-only prefix is invalid.
        allowedPrefixes: null,
        // Asset-picker surfaces always allow `@` (dialog lists the inventory).
        // Surfaces without a project still need attached mentions to arm `@`.
        allow: () => Boolean(storage.assetPicker?.enabled) || storage.mentions.length > 0,
        items: ({ query }) => {
          // Project inventory uses AssetSelectDialog — no inline dropdown list.
          if (storage.assetPicker?.enabled) return [];
          const normalized = query.toLowerCase();
          return storage.mentions
            .filter(
              (item) =>
                !normalized ||
                item.label.toLowerCase().includes(normalized) ||
                item.name?.toLowerCase().includes(normalized)
            )
            .slice(0, 10);
        },
        command: ({ editor, props: item, range }) => {
          if (!editor.view.composing) mentionInsertion(editor, range, item);
        },
        render: () => {
          let active = 0;
          let suggestion: SuggestionProps<MentionItem> | null = null;
          const publish = () => setMenu(suggestion ? { active, suggestion } : null);

          return {
            onStart: (props) => {
              const picker = storage.assetPicker;
              if (picker?.enabled) {
                picker.open({ editor: props.editor, range: props.range });
                suggestion = null;
                publish();
                return;
              }
              active = 0;
              suggestion = props;
              publish();
            },
            onUpdate: (props) => {
              const picker = storage.assetPicker;
              if (picker?.enabled) {
                // Keep the replace-range current while `@query` is still typing
                // before focus moves into the dialog.
                picker.updateRange(props.range);
                return;
              }
              suggestion = props;
              active = Math.max(0, Math.min(active, props.items.length - 1));
              publish();
            },
            onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
              if (view.composing || event.isComposing || event.keyCode === 229) return false;
              if (storage.assetPicker?.enabled) {
                // Dialog owns Escape / selection; don't intercept in the editor.
                return false;
              }
              if (!suggestion) return false;
              if (
                (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                suggestion.items.length
              ) {
                event.preventDefault();
                const delta = event.key === "ArrowDown" ? 1 : -1;
                active = (active + delta + suggestion.items.length) % suggestion.items.length;
                publish();
                return true;
              }
              if (event.key === "Enter" && suggestion.items[active]) {
                event.preventDefault();
                suggestion.command(suggestion.items[active]);
                return true;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                suggestion = null;
                publish();
                return true;
              }
              return false;
            },
            onExit: () => {
              // Keep the pending insert session while the asset dialog holds
              // focus — TipTap otherwise tears the suggestion down on blur.
              if (storage.assetPicker?.isOpen()) return;
              suggestion = null;
              publish();
            },
          };
        },
      }),
    ];
  },
});

function PromptMentionMenuPortal({ state }: { state: MentionMenuState }) {
  if (typeof document === "undefined") return null;
  const rect = state.suggestion.clientRect?.();
  if (!rect) return null;

  const viewportGap = 8;
  const menuWidth = 256;
  const estimatedHeight = Math.max(42, Math.min(state.suggestion.items.length, 10) * 44 + 12);
  const below = rect.bottom + 6;
  const top =
    below + estimatedHeight <= window.innerHeight - viewportGap
      ? below
      : Math.max(viewportGap, rect.top - estimatedHeight - 6);
  const left = Math.min(
    Math.max(viewportGap, rect.left),
    Math.max(viewportGap, window.innerWidth - menuWidth - viewportGap)
  );

  return createPortal(
    <MentionMenu
      options={state.suggestion.items}
      active={state.active}
      onPick={(item) => {
        if (!state.suggestion.editor.view.composing) state.suggestion.command(item);
      }}
      style={{ position: "fixed", top, left, zIndex: 1000 }}
    />,
    document.body
  );
}

function editorPrompt(editor: Editor): string {
  return promptDocumentToText(editor.getJSON());
}

function syncEditorDocument(
  editor: Editor,
  value: string,
  mentions: readonly MentionItem[]
): boolean {
  const content = promptTextToDocument(value, mentions);
  const canonicalDocument = editor.schema.nodeFromJSON(content);
  if (editor.state.doc.eq(canonicalDocument)) return false;

  return editor
    .chain()
    .setContent(content, { emitUpdate: false, errorOnInvalidContent: true })
    .setMeta("addToHistory", false)
    .run();
}

/**
 * IME-safe prompt editor backed by one ProseMirror layout tree. Reference chips,
 * text, selection, caret, wrapping, and scroll height now share the same DOM;
 * the persisted/Yjs/backend value remains the existing plain `@Image1` string.
 *
 * When `projectId` is set (project canvas / storyboard), typing `@` opens
 * {@link AssetSelectDialog} over the unified project inventory. Without a
 * project, `@` still uses the inline {@link MentionMenu} over `mentions`.
 */
export function PromptTextarea({
  value,
  onCommit,
  mentions = EMPTY_MENTIONS,
  projectId,
  className,
  placeholder,
  rows = 4,
  autoFocus = false,
  disabled = false,
  readOnly = false,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  onKeyDown,
  onBlur,
}: {
  value: string;
  onCommit: (next: string) => void;
  mentions?: readonly MentionItem[];
  /**
   * When set, `@` opens the project asset picker (canvas + crew inventory)
   * instead of the inline attached-reference menu. Requires CanvasGraphProvider.
   */
  projectId?: string;
  className?: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** Capture keydown at the editor DOM level (for grid Tab/Enter/Esc nav). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Fired when the editor loses focus. */
  onBlur?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [menuState, setMenuState] = useState<MentionMenuState | null>(null);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const lastCommittedRef = useRef(value);
  const pendingAssetInsertRef = useRef<AssetPickerSession | null>(null);
  const assetDialogOpenRef = useRef(false);

  useEffect(() => {
    lastCommittedRef.current = value;
  }, [value]);

  useEffect(() => {
    assetDialogOpenRef.current = assetDialogOpen;
  }, [assetDialogOpen]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        dropcursor: false,
        gapcursor: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        link: false,
        listItem: false,
        listKeymap: false,
        orderedList: false,
        strike: false,
        trailingNode: false,
        underline: false,
      }),
      Placeholder.configure({
        placeholder: ({ editor }) => editor.storage.promptMention.placeholder,
      }),
      PromptMentionNode.configure({
        setMenu: setMenuState,
      }),
    ],
    []
  );

  const emitPrompt = (next: string) => {
    if (lastCommittedRef.current === next) return;
    lastCommittedRef.current = next;
    onCommit(next);
  };

  const editorClassName = cn(
    className,
    "h-full cursor-text whitespace-pre-wrap break-words scroll-pb-2 overflow-y-auto",
    "[&>p]:m-0",
    "[&_.is-editor-empty:first-child]:before:pointer-events-none",
    "[&_.is-editor-empty:first-child]:before:float-left",
    "[&_.is-editor-empty:first-child]:before:h-0",
    "[&_.is-editor-empty:first-child]:before:text-muted-foreground",
    "[&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]"
  );

  const editor = useEditor(
    {
      immediatelyRender: false,
      editable: !disabled && !readOnly,
      extensions,
      content: promptTextToDocument(value, mentions),
      editorProps: {
        attributes: {
          ...(id ? { id } : {}),
          ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
          "aria-label": ariaLabel ?? placeholder ?? "Prompt",
          "aria-multiline": "true",
          "data-canvas-scroll-owner": "y",
          class: editorClassName,
          style: `min-height: ${Math.max(1, rows) * 24 + 8}px`,
        },
        handleDOMEvents: {
          compositionstart: () => {
            setComposing(true);
            setMenuState(null);
            return false;
          },
          compositionend: (view) => {
            setComposing(false);
            window.setTimeout(() => {
              emitPrompt(promptDocumentToText(view.state.doc.toJSON()));
            }, 0);
            return false;
          },
        },
      },
      onFocus: () => setFocused(true),
      onBlur: ({ editor: instance }) => {
        // Focus moves into AssetSelectDialog — keep the insert session alive
        // and do not treat this as a real blur/commit cycle.
        if (assetDialogOpenRef.current) return;
        setFocused(false);
        setMenuState(null);
        if (!instance.view.composing) {
          syncEditorDocument(instance, editorPrompt(instance), mentions);
        }
        exitSuggestion(instance.view);
        onBlur?.();
      },
      onUpdate: ({ editor: instance, transaction }) => {
        if (transaction.docChanged && !instance.view.composing) {
          emitPrompt(editorPrompt(instance));
        }
      },
    },
    []
  );

  const closeAssetDialog = () => {
    setAssetDialogOpen(false);
    pendingAssetInsertRef.current = null;
    const activeEditor = editor;
    if (activeEditor) {
      exitSuggestion(activeEditor.view);
      // Restore caret after dialog focus steal so the user can keep typing.
      requestAnimationFrame(() => activeEditor.commands.focus());
    }
  };

  const pickAssetMention = (item: MentionItem) => {
    const pending = pendingAssetInsertRef.current;
    setAssetDialogOpen(false);
    pendingAssetInsertRef.current = null;
    if (!pending) return;
    if (!pending.editor.view.composing) {
      mentionInsertion(pending.editor, pending.range, item);
    }
    exitSuggestion(pending.editor.view);
    requestAnimationFrame(() => pending.editor.commands.focus());
  };

  useEffect(() => {
    if (!editor) return;
    editor.commands.updatePromptMentionRuntime({ mentions });
  }, [editor, mentions]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.updatePromptMentionRuntime({
      assetPicker:
        projectId && !disabled && !readOnly
          ? {
              enabled: true,
              isOpen: () => assetDialogOpenRef.current,
              open: (session) => {
                pendingAssetInsertRef.current = session;
                setAssetDialogOpen(true);
              },
              updateRange: (range) => {
                const pending = pendingAssetInsertRef.current;
                if (pending) pending.range = range;
              },
            }
          : null,
    });
  }, [disabled, editor, projectId, readOnly]);

  useEffect(() => {
    if (!editor || focused || composing || editor.view.composing) return;
    // Don't remount the doc while the asset dialog has focus — the editor
    // still counts as "focused" for our session even though DOM focus left.
    if (assetDialogOpen) return;
    syncEditorDocument(editor, value, mentions);
  }, [assetDialogOpen, composing, editor, focused, mentions, value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled && !readOnly);
  }, [disabled, editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.updatePromptMentionRuntime({ placeholder: placeholder ?? "" });
    // Re-evaluate Placeholder's function when the generation mode changes.
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
  }, [editor, placeholder]);

  useEffect(() => {
    if (!editor || !autoFocus || disabled || readOnly) return;
    const frame = requestAnimationFrame(() => editor.commands.focus("end"));
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, disabled, editor, readOnly]);

  const editorContext = useMemo<PromptEditorContextValue>(
    () => ({ editable: !disabled && !readOnly, mentions }),
    [disabled, mentions, readOnly]
  );

  return (
    <div
      className={cn(
        "nodrag nowheel relative flex h-full w-full flex-col [&_.tiptap]:h-full [&_.tiptap]:flex-1 [&_.tiptap.ProseMirror]:h-full [&_.tiptap.ProseMirror]:flex-1 [&>div]:h-full [&>div]:flex-1",
        className
      )}
      onWheelCapture={(event) => event.stopPropagation()}
      onScrollCapture={() => {
        setMenuState((current) => (current ? { ...current } : null));
      }}
      onKeyDownCapture={onKeyDown}
    >
      <PromptEditorContext.Provider value={editorContext}>
        <EditorContent editor={editor} />
      </PromptEditorContext.Provider>
      {menuState && !composing ? <PromptMentionMenuPortal state={menuState} /> : null}
      {projectId ? (
        <AssetSelectDialog
          open={assetDialogOpen}
          projectId={projectId}
          onClose={closeAssetDialog}
          onSelect={pickAssetMention}
        />
      ) : null}
    </div>
  );
}
