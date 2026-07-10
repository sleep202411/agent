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

type PromptMentionNodeOptions = {
  setMenu: (state: MentionMenuState | null) => void;
};

type PromptMentionNodeStorage = {
  mentions: readonly MentionItem[];
  placeholder: string;
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
    };
  },

  addCommands() {
    return {
      updatePromptMentionRuntime: (runtime) => () => {
        if (runtime.mentions !== undefined) this.storage.mentions = runtime.mentions;
        if (runtime.placeholder !== undefined) this.storage.placeholder = runtime.placeholder;
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
        allow: () => storage.mentions.length > 0,
        items: ({ query }) => {
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
              active = 0;
              suggestion = props;
              publish();
            },
            onUpdate: (props) => {
              suggestion = props;
              active = Math.max(0, Math.min(active, props.items.length - 1));
              publish();
            },
            onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
              if (view.composing || event.isComposing || event.keyCode === 229) return false;
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
 */
export function PromptTextarea({
  value,
  onCommit,
  mentions = EMPTY_MENTIONS,
  className,
  placeholder,
  rows = 4,
  autoFocus = false,
  disabled = false,
  readOnly = false,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string;
  onCommit: (next: string) => void;
  mentions?: readonly MentionItem[];
  className?: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [menuState, setMenuState] = useState<MentionMenuState | null>(null);
  const lastCommittedRef = useRef(value);

  useEffect(() => {
    lastCommittedRef.current = value;
  }, [value]);

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
    "cursor-text whitespace-pre-wrap break-words scroll-pb-2",
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
        setFocused(false);
        setMenuState(null);
        if (!instance.view.composing) {
          syncEditorDocument(instance, editorPrompt(instance), mentions);
        }
        exitSuggestion(instance.view);
      },
      onUpdate: ({ editor: instance, transaction }) => {
        if (transaction.docChanged && !instance.view.composing) {
          emitPrompt(editorPrompt(instance));
        }
      },
    },
    []
  );

  useEffect(() => {
    if (!editor) return;
    editor.commands.updatePromptMentionRuntime({ mentions });
  }, [editor, mentions]);

  useEffect(() => {
    if (!editor || focused || composing || editor.view.composing) return;
    syncEditorDocument(editor, value, mentions);
  }, [composing, editor, focused, mentions, value]);

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
      className="nodrag nowheel relative"
      onWheelCapture={(event) => event.stopPropagation()}
      onScrollCapture={() => {
        setMenuState((current) => (current ? { ...current } : null));
      }}
    >
      <PromptEditorContext.Provider value={editorContext}>
        <EditorContent editor={editor} />
      </PromptEditorContext.Provider>
      {menuState && !composing ? <PromptMentionMenuPortal state={menuState} /> : null}
    </div>
  );
}
