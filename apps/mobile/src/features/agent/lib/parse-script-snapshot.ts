/**
 * Convert Story Script `contentSnapshot` (Yjs XmlFragment JSON / TipTap doc)
 * into markdown for read-only mobile rendering. PC edits via TipTap+Yjs; mobile
 * only displays the materialized snapshot (no yjs runtime — Metro cannot resolve
 * yjs → isomorphic-webcrypto on React Native).
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function joinText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(joinText).join("");
  if (isRecord(value)) {
    if (typeof value.text === "string") return value.text;
    if (Array.isArray(value.content)) return value.content.map(joinText).join("");
    return Object.values(value).map(joinText).filter(Boolean).join("");
  }
  return "";
}

function escapeMarkdownInline(text: string): string {
  return text.replace(/([\\`*_[\]{}<>])/g, "\\$1");
}

function inlineFromTipTapNodes(nodes: unknown): string {
  if (!Array.isArray(nodes)) return escapeMarkdownInline(joinText(nodes));
  let out = "";
  for (const node of nodes) {
    if (!isRecord(node)) {
      out += escapeMarkdownInline(joinText(node));
      continue;
    }
    if (node.type === "hardBreak") {
      out += "  \n";
      continue;
    }
    if (node.type === "text") {
      let chunk = escapeMarkdownInline(typeof node.text === "string" ? node.text : joinText(node));
      const marks = Array.isArray(node.marks) ? node.marks : [];
      for (const mark of marks) {
        if (!isRecord(mark) || typeof mark.type !== "string") continue;
        if (mark.type === "bold" || mark.type === "strong") chunk = `**${chunk}**`;
        else if (mark.type === "italic" || mark.type === "em") chunk = `*${chunk}*`;
        else if (mark.type === "code") chunk = `\`${chunk}\``;
        else if (mark.type === "strike") chunk = `~~${chunk}~~`;
        else if (
          mark.type === "link" &&
          isRecord(mark.attrs) &&
          typeof mark.attrs.href === "string"
        ) {
          chunk = `[${chunk}](${mark.attrs.href})`;
        }
      }
      out += chunk;
      continue;
    }
    out += inlineFromTipTapNodes(node.content);
  }
  return out;
}

function tipTapDocToMarkdown(doc: Record<string, JsonValue>): string {
  const nodes = Array.isArray(doc.content) ? doc.content : [];
  const lines: string[] = [];
  let orderedIndex = 0;

  const flushParagraph = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) lines.push(trimmed);
    lines.push("");
  };

  const walkBlocks = (blockNodes: JsonValue[], listPrefix?: string) => {
    for (const node of blockNodes) {
      if (!isRecord(node) || typeof node.type !== "string") continue;
      const type = node.type;
      if (type === "heading") {
        orderedIndex = 0;
        const level =
          isRecord(node.attrs) &&
          (node.attrs.level === 1 || node.attrs.level === 2 || node.attrs.level === 3)
            ? node.attrs.level
            : 2;
        const text = inlineFromTipTapNodes(node.content);
        lines.push(`${"#".repeat(level)} ${text}`);
        lines.push("");
        continue;
      }
      if (type === "paragraph") {
        const text = inlineFromTipTapNodes(node.content);
        if (listPrefix) {
          lines.push(`${listPrefix}${text}`);
        } else {
          orderedIndex = 0;
          flushParagraph(text);
        }
        continue;
      }
      if (type === "blockquote") {
        orderedIndex = 0;
        const inner = tipTapDocToMarkdown({ type: "doc", content: node.content ?? [] })
          .split("\n")
          .map((line) => (line.length ? `> ${line}` : ">"))
          .join("\n");
        lines.push(inner);
        lines.push("");
        continue;
      }
      if (type === "codeBlock") {
        orderedIndex = 0;
        const code = joinText(node.content);
        lines.push("```");
        lines.push(code);
        lines.push("```");
        lines.push("");
        continue;
      }
      if (type === "bulletList") {
        orderedIndex = 0;
        walkBlocks(Array.isArray(node.content) ? node.content : [], "- ");
        lines.push("");
        continue;
      }
      if (type === "orderedList") {
        orderedIndex = 0;
        const items = Array.isArray(node.content) ? node.content : [];
        for (const item of items) {
          orderedIndex += 1;
          if (!isRecord(item)) continue;
          walkBlocks(Array.isArray(item.content) ? item.content : [], `${orderedIndex}. `);
        }
        lines.push("");
        continue;
      }
      if (type === "listItem") {
        walkBlocks(Array.isArray(node.content) ? node.content : [], listPrefix ?? "- ");
        continue;
      }
      if (type === "horizontalRule") {
        orderedIndex = 0;
        lines.push("---");
        lines.push("");
        continue;
      }
      if (type === "hardBreak") {
        lines.push("");
        continue;
      }
      const fallback = inlineFromTipTapNodes(node.content ?? node);
      if (fallback.trim()) flushParagraph(fallback);
    }
  };

  walkBlocks(nodes);
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Yjs `XmlFragment.toJSON()` for TipTap Collaboration is an XML string, e.g.
 * `<heading level="1">Title</heading><paragraph>Hello <bold>world</bold></paragraph>`.
 */
function yjsXmlToMarkdown(xml: string): string {
  const trimmed = xml.trim();
  if (!trimmed) return "";

  type Tok =
    | { kind: "open"; name: string; attrs: Record<string, string> }
    | { kind: "close"; name: string }
    | { kind: "text"; value: string };

  function isCloseTok(tok: Tok | undefined, name: string): boolean {
    return tok?.kind === "close" && tok.name === name;
  }

  const tokens: Tok[] = [];
  const re =
    /<\/?([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed))) {
    if (match[3] != null) {
      tokens.push({ kind: "text", value: decodeXmlEntities(match[3]) });
      continue;
    }
    const name = match[1].toLowerCase();
    const raw = match[0];
    if (raw.startsWith("</")) {
      tokens.push({ kind: "close", name });
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let attrMatch: RegExpExecArray | null;
    const attrBlob = match[2] ?? "";
    while ((attrMatch = attrRe.exec(attrBlob))) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "true";
    }
    tokens.push({ kind: "open", name, attrs });
    if (raw.endsWith("/>") || name === "hardbreak" || name === "horizontalrule") {
      tokens.push({ kind: "close", name });
    }
  }

  let i = 0;
  const parseInline = (stopNames: Set<string>): string => {
    let out = "";
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.kind === "close" && stopNames.has(tok.name)) break;
      if (tok.kind === "text") {
        out += escapeMarkdownInline(tok.value);
        i += 1;
        continue;
      }
      if (tok.kind === "open") {
        i += 1;
        if (tok.name === "hardbreak") {
          out += "  \n";
          continue;
        }
        const inner = parseInline(new Set([tok.name]));
        if (isCloseTok(tokens[i], tok.name)) i += 1;
        if (tok.name === "bold" || tok.name === "strong") out += `**${inner}**`;
        else if (tok.name === "italic" || tok.name === "em") out += `*${inner}*`;
        else if (tok.name === "code") out += `\`${inner}\``;
        else if (tok.name === "strike" || tok.name === "s") out += `~~${inner}~~`;
        else if (tok.name === "link" && tok.attrs.href) out += `[${inner}](${tok.attrs.href})`;
        else out += inner;
        continue;
      }
      break;
    }
    return out;
  };

  const parseBlocks = (stopNames: Set<string>, listPrefix?: string): string[] => {
    const lines: string[] = [];
    let ordered = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.kind === "close" && stopNames.has(tok.name)) break;
      if (tok.kind === "text") {
        const text = tok.value.trim();
        if (text)
          lines.push(
            listPrefix ? `${listPrefix}${escapeMarkdownInline(text)}` : escapeMarkdownInline(text)
          );
        i += 1;
        continue;
      }
      if (tok.kind !== "open") {
        i += 1;
        continue;
      }
      i += 1;
      const name = tok.name;
      if (name === "heading") {
        const level = tok.attrs.level === "1" ? 1 : tok.attrs.level === "3" ? 3 : 2;
        const text = parseInline(new Set([name]));
        if (isCloseTok(tokens[i], name)) i += 1;
        lines.push(`${"#".repeat(level)} ${text}`);
        lines.push("");
        continue;
      }
      if (name === "paragraph") {
        const text = parseInline(new Set([name]));
        if (isCloseTok(tokens[i], name)) i += 1;
        if (listPrefix) lines.push(`${listPrefix}${text}`);
        else {
          if (text.trim()) lines.push(text);
          lines.push("");
        }
        continue;
      }
      if (name === "blockquote") {
        const inner = parseBlocks(new Set([name])).join("\n");
        if (isCloseTok(tokens[i], name)) i += 1;
        for (const line of inner.split("\n")) lines.push(line.length ? `> ${line}` : ">");
        lines.push("");
        continue;
      }
      if (name === "codeblock") {
        const text = parseInline(new Set([name]));
        if (isCloseTok(tokens[i], name)) i += 1;
        lines.push("```");
        lines.push(text.replace(/\\([\\`*_[\]{}<>])/g, "$1"));
        lines.push("```");
        lines.push("");
        continue;
      }
      if (name === "bulletlist") {
        const items = parseBlocks(new Set([name]), "- ");
        if (isCloseTok(tokens[i], name)) i += 1;
        lines.push(...items, "");
        continue;
      }
      if (name === "orderedlist") {
        ordered = 0;
        const start = i;
        // Re-parse list items with numbering by walking listitem opens.
        i = start;
        while (i < tokens.length) {
          const itemTok = tokens[i];
          if (itemTok.kind === "close" && itemTok.name === name) break;
          if (itemTok.kind === "open" && itemTok.name === "listitem") {
            ordered += 1;
            i += 1;
            const itemLines = parseBlocks(new Set(["listitem"]), `${ordered}. `);
            if (isCloseTok(tokens[i], "listitem")) i += 1;
            lines.push(...itemLines);
            continue;
          }
          i += 1;
        }
        if (isCloseTok(tokens[i], name)) i += 1;
        lines.push("");
        continue;
      }
      if (name === "listitem") {
        const itemLines = parseBlocks(new Set([name]), listPrefix ?? "- ");
        if (isCloseTok(tokens[i], name)) i += 1;
        lines.push(...itemLines);
        continue;
      }
      if (name === "horizontalrule") {
        if (isCloseTok(tokens[i], name)) i += 1;
        lines.push("---", "");
        continue;
      }
      const fallback = parseInline(new Set([name]));
      if (isCloseTok(tokens[i], name)) i += 1;
      if (fallback.trim()) {
        lines.push(listPrefix ? `${listPrefix}${fallback}` : fallback);
        if (!listPrefix) lines.push("");
      }
    }
    return lines;
  };

  return parseBlocks(new Set())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Convert materialized script snapshot (Yjs XML string or TipTap JSON) to markdown. */
export function scriptDocumentToMarkdown(input: { contentSnapshot?: unknown }): string {
  const snapshot = isRecord(input.contentSnapshot) ? input.contentSnapshot : null;
  const content = snapshot?.content;

  if (typeof content === "string" && content.trim()) {
    return yjsXmlToMarkdown(content);
  }
  if (isRecord(content) && (content.type === "doc" || Array.isArray(content.content))) {
    return tipTapDocToMarkdown(content);
  }
  // Some payloads nest the doc at the snapshot root.
  if (snapshot && typeof snapshot.type === "string" && snapshot.type === "doc") {
    return tipTapDocToMarkdown(snapshot);
  }

  return "";
}
