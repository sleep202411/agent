"use client";

import {
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
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
import {
  MentionChip,
  MentionMenu,
  SkillMentionDialog,
  type MentionItem,
  type SkillMarketItem,
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
const MENTION_TRIGGER_ACTIVATION_KEY = new PluginKey("promptMentionTriggerActivation");
const REFERENCE_SUGGESTION_KEY = new PluginKey("promptReferenceSuggestion");
const SKILL_SUGGESTION_KEY = new PluginKey("promptSkillSuggestion");

type PromptEditorContextValue = {
  editable: boolean;
  mentions: readonly MentionItem[];
  onMentionActivate?: (mention: MentionItem) => void;
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

type PromptMentionNodeOptions = {
  setMenu: (state: MentionMenuState | null) => void;
};

type PromptMentionNodeStorage = {
  mentions: readonly MentionItem[];
  placeholder: string;
};

type SkillDialogState = {
  options: MentionItem[];
  suggestion: SuggestionProps<MentionItem> | null;
};

export type PromptTextareaHandle = {
  openSkillPicker: () => void;
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
    previewVideoUrl: item.previewVideoUrl ?? "",
    assetId: item.assetId ?? "",
    durationSeconds: item.durationSeconds ?? null,
    bytes: item.bytes ?? null,
    width: item.width ?? null,
    height: item.height ?? null,
  };
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
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
    assetId: String(node.attrs.assetId ?? "") || undefined,
    durationSeconds: optionalFiniteNumber(node.attrs.durationSeconds),
    bytes: optionalFiniteNumber(node.attrs.bytes),
    width: optionalFiniteNumber(node.attrs.width),
    height: optionalFiniteNumber(node.attrs.height),
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
  const { editable, mentions, onMentionActivate } = useContext(PromptEditorContext);
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
        onActivate={
          mention.kind === "skill" && onMentionActivate
            ? () => onMentionActivate(mention)
            : undefined
        }
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
      previewVideoUrl: { default: "", rendered: false },
      assetId: { default: "", rendered: false },
      durationSeconds: { default: null, rendered: false },
      bytes: { default: null, rendered: false },
      width: { default: null, rendered: false },
      height: { default: null, rendered: false },
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
            assetId: element.dataset.assetId ?? "",
            durationSeconds: optionalFiniteNumber(element.dataset.durationSeconds),
            bytes: optionalFiniteNumber(element.dataset.bytes),
            width: optionalFiniteNumber(element.dataset.width),
            height: optionalFiniteNumber(element.dataset.height),
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
        "data-asset-id": node.attrs.assetId,
        "data-duration-seconds": node.attrs.durationSeconds,
        "data-bytes": node.attrs.bytes,
        "data-width": node.attrs.width,
        "data-height": node.attrs.height,
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
    const { setMenu } = this.options;
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
        // References may follow Chinese text directly. Slash Skills follow the
        // standard command boundary to avoid opening on URLs and aspect ratios.
        allowedPrefixes: kind === "reference" ? null : [" "],
        allow: () =>
          storage.mentions.some((item) =>
            kind === "skill" ? item.kind === "skill" : item.kind !== "skill"
          ),
        shouldShow: ({ editor, text }) => {
          if (!editor.isFocused) return false;
          if (!userActivated && text === char && triggerActivation[kind]) {
            userActivated = true;
          }
          triggerActivation[kind] = false;
          return userActivated;
        },
        items: ({ query }) => {
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
              active = 0;
              suggestion = props;
              publish();
            },
            onUpdate: (props) => {
              suggestion = props;
              const visibleCount = Math.min(props.items.length, kind === "skill" ? 8 : 10);
              active = Math.max(0, Math.min(active, visibleCount - 1));
              publish();
            },
            onKeyDown: ({ event, view }: SuggestionKeyDownProps) => {
              if (view.composing || event.isComposing || event.keyCode === 229) return false;
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
    // The suggestion may be exiting while React commits; its decoration rect
    // remains a safe one-frame fallback.
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
 * IME-safe prompt editor backed by one ProseMirror layout tree. Reference and
 * Skill chips, text, selection, caret, wrapping, and scroll height share the
 * same DOM; callers still own the persisted wire representation.
 */
export function PromptTextarea({
  ref: imperativeRef,
  value,
  onCommit,
  mentions = EMPTY_MENTIONS,
  skillMarketOptions,
  skillMarketLoading = false,
  skillMarketError = false,
  className,
  placeholder,
  rows = 4,
  autoFocus = false,
  disabled = false,
  readOnly = false,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  onMentionActivate,
  onSkillMarketRetry,
  onOpenSkillMarket,
  onKeyDown,
  onBlur,
}: {
  ref?: Ref<PromptTextareaHandle>;
  value: string;
  onCommit: (next: string) => void;
  mentions?: readonly MentionItem[];
  skillMarketOptions?: readonly SkillMarketItem[];
  skillMarketLoading?: boolean;
  skillMarketError?: boolean;
  className?: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  /** Opens contextual UI for actionable inline entities such as Skills. */
  onMentionActivate?: (mention: MentionItem) => void;
  onSkillMarketRetry?: () => void;
  onOpenSkillMarket?: (catalogId: string, applySkill: (item: MentionItem) => void) => void;
  /** Capture keydown at the editor DOM level (for grid Tab/Enter/Esc nav). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Fired when the editor loses focus. */
  onBlur?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [menuState, setMenuState] = useState<MentionMenuState | null>(null);
  const [skillDialogState, setSkillDialogState] = useState<SkillDialogState | null>(null);
  const lastCommittedRef = useRef(value);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    lastCommittedRef.current = value;
  }, [value]);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

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
    onCommitRef.current(next);
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

  useImperativeHandle(
    imperativeRef,
    () => ({
      openSkillPicker: () => {
        if (!editor || disabled || readOnly) return;
        setMenuState(null);
        exitSuggestion(editor.view, SKILL_SUGGESTION_KEY);
        setSkillDialogState({
          options: mentions.filter((item) => item.kind === "skill"),
          suggestion: null,
        });
      },
    }),
    [disabled, editor, mentions, readOnly]
  );

  const editorContext = useMemo<PromptEditorContextValue>(
    () => ({ editable: !disabled && !readOnly, mentions, onMentionActivate }),
    [disabled, mentions, onMentionActivate, readOnly]
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
        marketOptions={skillMarketOptions}
        marketLoading={skillMarketLoading}
        marketError={skillMarketError}
        onOpenChange={(open) => {
          if (!open) setSkillDialogState(null);
        }}
        onPick={(item) => {
          const state = skillDialogState;
          if (!state) return;
          if (state.suggestion) {
            if (!state.suggestion.editor.view.composing) state.suggestion.command(item);
            return;
          }
          if (!editor || editor.view.composing) return;
          mentionInsertion(
            editor,
            { from: editor.state.selection.from, to: editor.state.selection.to },
            item
          );
        }}
        onMarketRetry={onSkillMarketRetry}
        onOpenMarket={(catalogId) => {
          if (!editor || !onOpenSkillMarket) return;
          const state = skillDialogState;
          const selection = state?.suggestion?.range ?? editor.state.selection;
          const insertionRange = { from: selection.from, to: selection.to };
          onOpenSkillMarket(catalogId, (item) => {
            if (editor.isDestroyed || editor.view.composing) return;
            const maxPosition = Math.max(1, editor.state.doc.content.size - 1);
            const from = Math.min(insertionRange.from, maxPosition);
            const to = Math.max(from, Math.min(insertionRange.to, maxPosition));
            mentionInsertion(editor, { from, to }, item);
          });
        }}
      />
    </div>
  );
}
