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
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Suggestion, {
  exitSuggestion,
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { AssetSelectDialog } from "@/components/canvas/authoring/asset-select-dialog";
import {
  MentionChip,
  MentionMenu,
  SkillMentionDialog,
  type MentionItem,
} from "@/lib/prompt-mentions";
import {
  PROMPT_MENTION_NODE_NAME,
  promptDocumentToText,
  promptMentionParts,
  promptMentionToken,
  promptTextToDocument,
} from "@/lib/prompt-document";
import { cn } from "@/lib/utils";

const EMPTY_MENTIONS: readonly MentionItem[] = [];
const MENTION_TRIGGER_ACTIVATION_KEY = new PluginKey("storyboardPromptMentionTriggerActivation");
const REFERENCE_SUGGESTION_KEY = new PluginKey("storyboardPromptReferenceSuggestion");
const SKILL_SUGGESTION_KEY = new PluginKey("storyboardPromptSkillSuggestion");

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
  kind: "reference" | "skill";
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
  /** Storyboard-only — kept off Storage so we don't clash with canvas module augmentation. */
  getAssetPicker: () => AssetPickerHandle | null;
};

type PromptMentionNodeStorage = {
  mentions: readonly MentionItem[];
  placeholder: string;
};

type SkillDialogState = {
  options: MentionItem[];
  suggestion: SuggestionProps<MentionItem>;
};

function itemAttributes(item: MentionItem) {
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
    name: item.name ?? "",
    previewUrl: item.previewUrl ?? "",
    previewVideoUrl: item.previewVideoUrl ?? "",
  };
}

function mentionFromNode(node: NodeViewProps["node"]): MentionItem {
  const kind = node.attrs.kind;
  return {
    id: String(node.attrs.id ?? ""),
    kind: kind === "video" || kind === "audio" || kind === "skill" ? kind : "image",
    label: String(node.attrs.label ?? ""),
    name: String(node.attrs.name ?? "") || undefined,
    previewUrl: String(node.attrs.previewUrl ?? "") || undefined,
    previewVideoUrl: String(node.attrs.previewVideoUrl ?? "") || undefined,
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
        text={promptMentionToken(mention)}
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
      getAssetPicker: () => null,
    };
  },

  addStorage() {
    return {
      mentions: EMPTY_MENTIONS,
      placeholder: "",
    };
  },

  addAttributes() {
    return {
      id: { default: "", rendered: false },
      kind: { default: "image", rendered: false },
      label: { default: "", rendered: false },
      name: { default: "", rendered: false },
      previewUrl: { default: "", rendered: false },
      previewVideoUrl: { default: "", rendered: false },
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
            previewVideoUrl: element.dataset.previewVideoUrl ?? "",
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
        "data-preview-video-url": node.attrs.previewVideoUrl,
      }),
      promptMentionToken({
        kind:
          node.attrs.kind === "video" || node.attrs.kind === "audio" || node.attrs.kind === "skill"
            ? node.attrs.kind
            : "image",
        label: String(node.attrs.label ?? ""),
      }),
    ];
  },

  renderText({ node }) {
    return promptMentionToken({
      kind:
        node.attrs.kind === "video" || node.attrs.kind === "audio" || node.attrs.kind === "skill"
          ? node.attrs.kind
          : "image",
      label: String(node.attrs.label ?? ""),
    });
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
    const { setMenu, getAssetPicker } = this.options;
    const { storage } = this;
    const triggerActivation = { reference: false, skill: false };
    const armTypedTrigger = (text: string) => {
      triggerActivation.reference = text === "@";
      triggerActivation.skill = text === "/";
    };
    const triggerActivationPlugin = new Plugin({
      key: MENTION_TRIGGER_ACTIVATION_KEY,
      state: {
        init: () => null,
        apply: (_transaction, value) => {
          triggerActivation.reference = false;
          triggerActivation.skill = false;
          return value;
        },
      },
      props: {
        handleKeyDown: (_view, event) => {
          armTypedTrigger(event.isComposing || event.keyCode === 229 ? "" : event.key);
          return false;
        },
        handleTextInput: (_view, _from, _to, text) => {
          armTypedTrigger(text);
          return false;
        },
      },
    });
    const createSuggestion = ({
      char,
      kind,
      pluginKey,
    }: {
      char: "@" | "/";
      kind: "reference" | "skill";
      pluginKey: PluginKey;
    }) => {
      let userActivated = false;
      return Suggestion<MentionItem>({
        editor: this.editor,
        pluginKey,
        char,
        allowSpaces: false,
        allowedPrefixes: kind === "reference" ? null : [" "],
        // Storyboard always enables `@` via asset picker when projectId is set;
        // `/` only offers installed project Skills already in runtime mentions.
        allow: () =>
          kind === "reference"
            ? Boolean(getAssetPicker()?.enabled) ||
              storage.mentions.some((item) => item.kind !== "skill")
            : storage.mentions.some((item) => item.kind === "skill"),
        shouldShow: ({ editor, text }) => {
          if (!editor.isFocused) return false;
          if (!userActivated && text === char && triggerActivation[kind]) {
            userActivated = true;
          }
          triggerActivation[kind] = false;
          return userActivated;
        },
        items: ({ query }) => {
          // Project inventory uses AssetSelectDialog — no inline dropdown list.
          if (kind === "reference" && getAssetPicker()?.enabled) return [];
          const normalized = query.toLowerCase();
          const filtered = storage.mentions.filter(
            (item) =>
              (kind === "skill" ? item.kind === "skill" : item.kind !== "skill") &&
              (!normalized ||
                item.label.toLowerCase().includes(normalized) ||
                item.name?.toLowerCase().includes(normalized))
          );
          return kind === "skill" ? filtered : filtered.slice(0, 10);
        },
        command: ({ editor, props: item, range }) => {
          if (!editor.view.composing) mentionInsertion(editor, range, item);
        },
        render: () => {
          let active = 0;
          let suggestion: SuggestionProps<MentionItem> | null = null;
          const publish = () => setMenu(suggestion ? { active, kind, suggestion } : null);

          return {
            onStart: (props) => {
              const picker = getAssetPicker();
              if (kind === "reference" && picker?.enabled) {
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
              const picker = getAssetPicker();
              if (kind === "reference" && picker?.enabled) {
                picker.updateRange(props.range);
                return;
              }
              suggestion = props;
              const visibleCount = Math.min(props.items.length, kind === "skill" ? 8 : 10);
              active = Math.max(0, Math.min(active, visibleCount - 1));
              publish();
            },
            onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
              if (view.composing || event.isComposing || event.keyCode === 229) return false;
              if (kind === "reference" && getAssetPicker()?.enabled) return false;
              if (!suggestion) return false;
              if (
                (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                Math.min(suggestion.items.length, kind === "skill" ? 8 : 10)
              ) {
                event.preventDefault();
                const delta = event.key === "ArrowDown" ? 1 : -1;
                const visibleCount = Math.min(suggestion.items.length, kind === "skill" ? 8 : 10);
                active = (active + delta + visibleCount) % visibleCount;
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
              userActivated = false;
              if (kind === "reference" && getAssetPicker()?.isOpen()) return;
              suggestion = null;
              publish();
            },
          };
        },
      });
    };

    return [
      createSuggestion({ char: "@", kind: "reference", pluginKey: REFERENCE_SUGGESTION_KEY }),
      createSuggestion({ char: "/", kind: "skill", pluginKey: SKILL_SUGGESTION_KEY }),
      // Keep this after Suggestion: its state hook clears the one-transaction
      // activation only after both suggestion plugins have inspected it.
      triggerActivationPlugin,
    ];
  },
});

function PromptMentionMenuPortal({
  state,
  onShowAll,
}: {
  state: MentionMenuState;
  onShowAll: () => void;
}) {
  if (typeof document === "undefined") return null;
  const fallbackRect = state.suggestion.clientRect?.();
  let caretRect = fallbackRect;
  try {
    const coords = state.suggestion.editor.view.coordsAtPos(state.suggestion.range.to);
    caretRect = {
      bottom: coords.bottom,
      height: coords.bottom - coords.top,
      left: coords.left,
      right: coords.right,
      top: coords.top,
      width: coords.right - coords.left,
      x: coords.left,
      y: coords.top,
      toJSON: () => ({}),
    };
  } catch {
    // Keep the decoration rect for the single exiting frame.
  }
  if (!caretRect) return null;

  const viewportGap = 8;
  const menuWidth = state.kind === "skill" ? 288 : 256;
  const itemHeight = state.kind === "skill" ? 52 : 44;
  const visibleCount = Math.min(state.suggestion.items.length, state.kind === "skill" ? 8 : 10);
  const footerHeight = state.kind === "skill" && state.suggestion.items.length > 8 ? 40 : 0;
  const estimatedHeight = Math.min(
    512,
    Math.max(42, visibleCount * itemHeight + footerHeight + 12)
  );
  const menuGap = 6;
  const spaceBelow = window.innerHeight - caretRect.bottom - menuGap - viewportGap;
  const spaceAbove = caretRect.top - menuGap - viewportGap;
  const placeAbove =
    estimatedHeight <= spaceBelow
      ? false
      : estimatedHeight <= spaceAbove
        ? true
        : spaceAbove > spaceBelow;
  const availableHeight = Math.max(42, placeAbove ? spaceAbove : spaceBelow);
  const renderedHeight = Math.min(estimatedHeight, availableHeight);
  const top = placeAbove
    ? Math.max(viewportGap, caretRect.top - renderedHeight - menuGap)
    : caretRect.bottom + menuGap;
  const left = Math.min(
    Math.max(viewportGap, caretRect.left),
    Math.max(viewportGap, window.innerWidth - menuWidth - viewportGap)
  );
  const originX = caretRect.left - left;
  const originY = (placeAbove ? caretRect.top : caretRect.bottom) - top;

  return createPortal(
    <MentionMenu
      options={
        state.kind === "skill"
          ? state.suggestion.items.slice(0, 8)
          : state.suggestion.items.slice(0, 10)
      }
      active={state.active}
      emptyKind={state.kind}
      totalCount={state.suggestion.items.length}
      onShowAll={state.kind === "skill" ? onShowAll : undefined}
      onPick={(item) => {
        if (!state.suggestion.editor.view.composing) state.suggestion.command(item);
      }}
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 1000,
        maxHeight: availableHeight,
        transformOrigin: `${originX}px ${originY}px`,
      }}
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
 * Storyboard-only prompt editor — forks canvas `PromptTextarea` so project
 * `@` → AssetSelectDialog does **not** leak into generation-card / composer.
 *
 * Canvas continues to use `@/components/canvas/authoring/prompt-textarea`
 * (attached-reference inline menu only). Do not import this from canvas code.
 *
 * IME-safe TipTap editor; persisted value remains plain `@Image1` strings.
 * `projectId` is required so `@` always opens the project asset inventory.
 */
export function StoryboardPromptTextarea({
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
  /** Project inventory for `@` → AssetSelectDialog. Requires CanvasGraphProvider. */
  projectId: string;
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
  const [skillDialogState, setSkillDialogState] = useState<SkillDialogState | null>(null);
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);
  const lastCommittedRef = useRef(value);
  const pendingAssetInsertRef = useRef<AssetPickerSession | null>(null);
  const assetDialogOpenRef = useRef(false);
  const assetPickerRef = useRef<AssetPickerHandle | null>(null);

  useEffect(() => {
    lastCommittedRef.current = value;
  }, [value]);

  useEffect(() => {
    assetDialogOpenRef.current = assetDialogOpen;
  }, [assetDialogOpen]);

  useEffect(() => {
    assetPickerRef.current =
      !disabled && !readOnly
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
        : null;
  }, [disabled, readOnly]);

  // getAssetPicker closes over a ref but only *reads* it when `@` fires (not paint).
  /* eslint-disable react-hooks/refs */
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
        placeholder: ({ editor }) => {
          const storage = editor.storage.promptMention as PromptMentionNodeStorage | undefined;
          return storage?.placeholder ?? "";
        },
      }),
      PromptMentionNode.configure({
        setMenu: setMenuState,
        getAssetPicker: () => assetPickerRef.current,
      }),
    ],
    []
  );
  /* eslint-enable react-hooks/refs */

  const emitPrompt = (next: string) => {
    if (lastCommittedRef.current === next) return;
    lastCommittedRef.current = next;
    onCommit(next);
  };

  /**
   * Storyboard-only: chrome lives on the outer shell (`className`).
   * ProseMirror stays transparent typography — never re-apply rounded/bg/ring
   * here or you get a double frame (shell + editor).
   * Canvas `PromptTextarea` still dual-applies className; do not copy that here.
   */
  const minHeightPx = Math.max(1, rows) * 24 + 8;
  const editorClassName = cn(
    "min-h-[var(--prompt-min-h)] cursor-text whitespace-pre-wrap break-words outline-none",
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
          style: `min-height: ${minHeightPx}px`,
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
        exitSuggestion(instance.view, REFERENCE_SUGGESTION_KEY);
        exitSuggestion(instance.view, SKILL_SUGGESTION_KEY);
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
      exitSuggestion(activeEditor.view, REFERENCE_SUGGESTION_KEY);
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
    exitSuggestion(pending.editor.view, REFERENCE_SUGGESTION_KEY);
    requestAnimationFrame(() => pending.editor.commands.focus());
  };

  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.promptMention as PromptMentionNodeStorage | undefined;
    // TipTap storage is a mutable bag (not React state); required for mention paste.
    if (storage) {
      // eslint-disable-next-line react-hooks/immutability -- TipTap storage API
      storage.mentions = mentions;
    }
  }, [editor, mentions]);

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
    const storage = editor.storage.promptMention as PromptMentionNodeStorage | undefined;
    if (storage) {
      // eslint-disable-next-line react-hooks/immutability -- TipTap storage API
      storage.placeholder = placeholder ?? "";
    }
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
        // Single painted surface: drawer/table pass chrome via `className`.
        // No canvas flex-fill chain — that dual-applies height with ProseMirror.
        "nodrag nowheel relative w-full overflow-y-auto",
        className
      )}
      style={{ ["--prompt-min-h" as string]: `${minHeightPx}px` } as React.CSSProperties}
      onWheelCapture={(event) => event.stopPropagation()}
      onScrollCapture={() => {
        setMenuState((current) => (current ? { ...current } : null));
      }}
      onKeyDownCapture={onKeyDown}
      // Padding/chrome clicks should focus the editor (native textarea feel).
      onMouseDown={(event) => {
        if (disabled || readOnly || !editor) return;
        const target = event.target as HTMLElement;
        if (target.closest(".tiptap, .ProseMirror")) return;
        event.preventDefault();
        editor.chain().focus("end").run();
      }}
    >
      <PromptEditorContext.Provider value={editorContext}>
        <EditorContent editor={editor} className="block w-full [&_.tiptap]:outline-none" />
      </PromptEditorContext.Provider>
      {menuState && !composing ? (
        <PromptMentionMenuPortal
          state={menuState}
          onShowAll={() =>
            setSkillDialogState({
              options: menuState.suggestion.items.filter((item) => item.kind === "skill"),
              suggestion: menuState.suggestion,
            })
          }
        />
      ) : null}
      <SkillMentionDialog
        open={Boolean(skillDialogState)}
        options={skillDialogState?.options ?? []}
        onOpenChange={(open) => {
          if (!open) setSkillDialogState(null);
        }}
        onPick={(item) => {
          const state = skillDialogState;
          if (state && !state.suggestion.editor.view.composing) state.suggestion.command(item);
        }}
      />
      <AssetSelectDialog
        open={assetDialogOpen}
        projectId={projectId}
        onClose={closeAssetDialog}
        onSelect={pickAssetMention}
      />
    </div>
  );
}
