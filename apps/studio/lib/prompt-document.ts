import type { JSONContent } from "@tiptap/core";

export const PROMPT_MENTION_NODE_NAME = "promptMention";

export type PromptMentionKind = "image" | "video" | "audio";

export type PromptMentionItem = {
  id: string;
  /** Token shown after the `@`, e.g. "Image1". */
  label: string;
  name?: string;
  kind: PromptMentionKind;
  previewUrl?: string;
};

export type PromptMentionPart = {
  end: number;
  mention?: PromptMentionItem;
  start: number;
  text: string;
};

function isMentionTokenEnd(value: string, end: number): boolean {
  if (end >= value.length) return true;
  return !/^[A-Za-z0-9_]/.test(value[end] ?? "");
}

function mentionAt(
  value: string,
  offset: number,
  mentions: readonly PromptMentionItem[]
): PromptMentionItem | undefined {
  if (value[offset] !== "@") return undefined;
  return [...mentions]
    .sort((a, b) => b.label.length - a.label.length)
    .find((mention) => {
      const token = `@${mention.label}`;
      const end = offset + token.length;
      return value.startsWith(token, offset) && isMentionTokenEnd(value, end);
    });
}

/** Split prompt text without changing its wire representation. */
export function promptMentionParts(
  value: string,
  mentions: readonly PromptMentionItem[]
): PromptMentionPart[] {
  const parts: PromptMentionPart[] = [];
  let offset = 0;
  while (offset < value.length) {
    const mention = mentionAt(value, offset, mentions);
    if (mention) {
      const end = offset + mention.label.length + 1;
      parts.push({ end, mention, start: offset, text: `@${mention.label}` });
      offset = end;
      continue;
    }
    const nextMentionOffset = value.indexOf("@", offset + 1);
    const end = nextMentionOffset === -1 ? value.length : nextMentionOffset;
    parts.push({ end, start: offset, text: value.slice(offset, end) });
    offset = end;
  }
  return parts;
}

function mentionNode(item: PromptMentionItem): JSONContent {
  return {
    type: PROMPT_MENTION_NODE_NAME,
    attrs: {
      id: item.id,
      kind: item.kind,
      label: item.label,
      name: item.name ?? "",
      previewUrl: item.previewUrl ?? "",
    },
  };
}

/** Parse the persisted plain prompt into Tiptap JSON without going through HTML. */
export function promptTextToDocument(
  value: string,
  mentions: readonly PromptMentionItem[]
): JSONContent {
  return {
    type: "doc",
    content: value.split("\n").map((line) => {
      const content = promptMentionParts(line, mentions).flatMap<JSONContent>((part) =>
        part.mention
          ? [mentionNode(part.mention)]
          : part.text
            ? [{ type: "text", text: part.text }]
            : []
      );
      return {
        type: "paragraph",
        ...(content.length > 0 ? { content } : {}),
      };
    }),
  };
}

function inlineNodeText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === PROMPT_MENTION_NODE_NAME) {
    const label = node.attrs?.label;
    return typeof label === "string" && label ? `@${label}` : "";
  }
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map(inlineNodeText).join("");
}

/**
 * Serialize the editor document back to the exact plain-text prompt contract.
 * Joining blocks ourselves preserves intentional empty/trailing lines.
 */
export function promptDocumentToText(document: JSONContent): string {
  return (document.content ?? []).map(inlineNodeText).join("\n");
}
