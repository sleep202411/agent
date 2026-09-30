// Canonical production document contract, mirrored from server production.dto.ts.
// Keep node/mark validation aligned with that HTTP contract. No Node runtime required.
import { z } from "zod";

export type CrewProductionDocument = {
  type: "doc";
  content: Record<string, unknown>[];
};

const DOCUMENT_NODE_LIMIT = 2_000;
const DOCUMENT_DEPTH_LIMIT = 24;
const DOCUMENT_TEXT_LIMIT = 250_000;
const DOCUMENT_BYTE_LIMIT = 2_000_000;

const BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "horizontalRule",
  "codeBlock",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
]);
const ATOM_NODE_TYPES = new Set(["horizontalRule"]);
const MARK_TYPES = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
  "textStyle",
  "highlight",
  "superscript",
  "subscript",
]);
const ROOT_BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "horizontalRule",
  "codeBlock",
  "table",
]);
const UNIQUE_ID_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
  "codeBlock",
  "table",
]);

/**
 * Tiptap JSON is executable editor state, not an unstructured metadata bag.
 * Validate the exact schema at the HTTP boundary so unsupported extensions,
 * copied domain snapshots, and oversized documents never enter PostgreSQL.
 */
export const CrewProductionDocumentSchema = z
  .unknown()
  .superRefine((value, context) => {
    const error = validateProductionDocument(value);
    if (error) context.addIssue({ code: "custom", message: error });
  })
  .transform((value) => value as CrewProductionDocument);

const PRODUCTION_ACTIVITY_TEXT_LIMIT = 20_000;

/**
 * Activity posts persist the same canonical Tiptap/ProseMirror JSON used by
 * the editor. Plain text is derived server-side for notifications, previews,
 * search, and accessibility; it is never accepted as a competing source of
 * truth from the client.
 */
export const CrewProductionActivityContentSchema = CrewProductionDocumentSchema.superRefine(
  (document, context) => {
    const plainText = productionDocumentPlainText(document).trim();
    if (!plainText) {
      context.addIssue({
        code: "custom",
        message: "Project activity content cannot be empty.",
      });
    } else if (plainText.length > PRODUCTION_ACTIVITY_TEXT_LIMIT) {
      context.addIssue({
        code: "custom",
        message: `Project activity content exceeds the ${PRODUCTION_ACTIVITY_TEXT_LIMIT}-character limit.`,
      });
    }
  }
);

export function productionDocumentPlainText(document: CrewProductionDocument): string {
  const blocks: string[] = [];
  for (const node of document.content) {
    blocks.push(productionNodePlainText(node));
  }
  return blocks.join("\n").replace(/\n{3,}/g, "\n\n");
}

function productionNodePlainText(node: Record<string, unknown>): string {
  if (node.type === "text") return typeof node.text === "string" ? node.text : "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "emoji") {
    const attrs = isRecord(node.attrs) ? node.attrs : null;
    return typeof attrs?.name === "string" ? `:${attrs.name}:` : "";
  }
  if (!Array.isArray(node.content)) return "";

  const separator =
    node.type === "bulletList" ||
    node.type === "orderedList" ||
    node.type === "taskList" ||
    node.type === "blockquote" ||
    node.type === "table" ||
    node.type === "tableRow"
      ? "\n"
      : "";
  return node.content.filter(isRecord).map(productionNodePlainText).join(separator);
}

export const UpdateProductionDocumentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    document: CrewProductionDocumentSchema,
  })
  .strict();
export type UpdateProductionDocumentInput = z.infer<typeof UpdateProductionDocumentSchema>;

function validateProductionDocument(value: unknown): string | null {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return "The production document must be valid JSON.";
  }
  if (typeof serialized !== "string") return "The production document must be valid JSON.";
  if (utf8Length(serialized) > DOCUMENT_BYTE_LIMIT) {
    return "The production document exceeds the 2 MB limit.";
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "content"])) {
    return "The production document root must contain only type and content.";
  }
  if (value.type !== "doc" || !Array.isArray(value.content)) {
    return "The production document root must be a Tiptap doc node.";
  }
  if (value.content.length === 0) {
    return "The production document must contain at least one block.";
  }

  const budget = { nodes: 1, text: 0 };
  for (const node of value.content) {
    const error = validateNode(node, 1, "rootBlock", budget);
    if (error) return error;
  }
  return null;
}

function validateNode(
  value: unknown,
  depth: number,
  expected: "rootBlock" | "block" | "inline" | "listItem" | "taskItem" | "tableRow" | "tableCell",
  budget: { nodes: number; text: number }
): string | null {
  if (depth > DOCUMENT_DEPTH_LIMIT) {
    return `The production document exceeds the ${DOCUMENT_DEPTH_LIMIT}-level nesting limit.`;
  }
  budget.nodes += 1;
  if (budget.nodes > DOCUMENT_NODE_LIMIT) {
    return `The production document exceeds the ${DOCUMENT_NODE_LIMIT}-node limit.`;
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return "Every production document node must be an object with a type.";
  }

  if (value.type === "text") {
    if (expected !== "inline") return "Text nodes are only valid inside inline content.";
    if (!hasOnlyKeys(value, ["type", "text", "marks"])) {
      return "Text nodes contain unsupported fields.";
    }
    if (typeof value.text !== "string" || value.text.length === 0) {
      return "Text nodes must contain non-empty text.";
    }
    budget.text += value.text.length;
    if (budget.text > DOCUMENT_TEXT_LIMIT) {
      return `The production document exceeds the ${DOCUMENT_TEXT_LIMIT}-character limit.`;
    }
    if (value.marks !== undefined) {
      if (!Array.isArray(value.marks)) return "Text marks must be an array.";
      for (const mark of value.marks) {
        if (!isRecord(mark) || typeof mark.type !== "string" || !MARK_TYPES.has(mark.type)) {
          return "The production document contains an unsupported text mark.";
        }
        if (mark.type === "link") {
          const linkError = validateLinkMark(mark);
          if (linkError) return linkError;
        } else if (mark.type === "textStyle" || mark.type === "highlight") {
          const colorError = validateColorMark(mark);
          if (colorError) return colorError;
        } else if (!hasOnlyKeys(mark, ["type"])) {
          return "The production document contains an unsupported text mark.";
        }
      }
    }
    return null;
  }

  if (value.type === "hardBreak") {
    if (expected !== "inline") return "Hard breaks are only valid inside inline content.";
    return hasOnlyKeys(value, ["type"]) ? null : "Hard breaks contain unsupported fields.";
  }

  if (value.type === "emoji") {
    if (expected !== "inline") return "Emoji nodes are only valid inside inline content.";
    if (
      !hasOnlyKeys(value, ["type", "attrs"]) ||
      !isRecord(value.attrs) ||
      !hasOnlyKeys(value.attrs, ["name"]) ||
      typeof value.attrs.name !== "string" ||
      value.attrs.name.length === 0 ||
      value.attrs.name.length > 120
    ) {
      return "Emoji nodes require a valid name.";
    }
    return null;
  }

  if (!BLOCK_NODE_TYPES.has(value.type)) {
    return `Unsupported production document node: ${value.type}.`;
  }
  if (expected === "inline") return `${value.type} is not valid inside inline content.`;
  if (
    (expected === "rootBlock" || expected === "block") &&
    !ROOT_BLOCK_NODE_TYPES.has(value.type)
  ) {
    return `${value.type} is not valid as a document block.`;
  }
  if (expected === "listItem" && value.type !== "listItem") {
    return "Lists may contain only list items.";
  }
  if (expected === "taskItem" && value.type !== "taskItem") {
    return "Task lists may contain only task items.";
  }
  if (expected === "tableRow" && value.type !== "tableRow") {
    return "Tables may contain only table rows.";
  }
  if (expected === "tableCell" && value.type !== "tableCell" && value.type !== "tableHeader") {
    return "Table rows may contain only cells or header cells.";
  }
  if (!hasOnlyKeys(value, ["type", "attrs", "content"])) {
    return `${value.type} contains unsupported fields.`;
  }

  const attrsError = validateNodeAttrs(value.type, value.attrs);
  if (attrsError) return attrsError;
  if (ATOM_NODE_TYPES.has(value.type)) {
    return value.content === undefined
      ? null
      : `${value.type} is an atomic node and cannot contain copied business data.`;
  }

  const content = value.content;
  if (value.type === "paragraph" || value.type === "heading" || value.type === "codeBlock") {
    if (content === undefined) return null;
    if (!Array.isArray(content)) return `${value.type} content must be an array.`;
    for (const child of content) {
      if (value.type === "codeBlock" && (!isRecord(child) || child.type !== "text")) {
        return "Code blocks may contain only text.";
      }
      if (value.type === "codeBlock" && isRecord(child) && child.marks !== undefined) {
        return "Code-block text cannot contain inline marks.";
      }
      const error = validateNode(child, depth + 1, "inline", budget);
      if (error) return error;
    }
    return null;
  }

  if (value.type === "table") {
    if (!Array.isArray(content) || content.length === 0) {
      return "Tables must contain at least one row.";
    }
    for (const child of content) {
      const error = validateNode(child, depth + 1, "tableRow", budget);
      if (error) return error;
    }
    return null;
  }

  if (value.type === "tableRow") {
    if (!Array.isArray(content) || content.length === 0) {
      return "Table rows must contain at least one cell.";
    }
    for (const child of content) {
      const error = validateNode(child, depth + 1, "tableCell", budget);
      if (error) return error;
    }
    return null;
  }

  if (!Array.isArray(content) || content.length === 0) {
    return `${value.type} must contain at least one child node.`;
  }
  const childExpectation =
    value.type === "bulletList" || value.type === "orderedList"
      ? "listItem"
      : value.type === "taskList"
        ? "taskItem"
        : "block";
  for (const child of content) {
    const error = validateNode(child, depth + 1, childExpectation, budget);
    if (error) return error;
  }
  return null;
}

function validateNodeAttrs(type: string, value: unknown): string | null {
  if (!isRecord(value)) {
    if (UNIQUE_ID_NODE_TYPES.has(type) || type === "taskItem") {
      return `${type} requires an attributes object.`;
    }
    return value === undefined ? null : `${type} attributes must be an object.`;
  }
  const allowed: string[] = [];
  if (UNIQUE_ID_NODE_TYPES.has(type)) allowed.push("id");
  if (type === "heading") allowed.push("level");
  if (type === "orderedList") allowed.push("start", "type");
  if (type === "taskItem") allowed.push("checked");
  if (type === "codeBlock") allowed.push("language");
  if (type === "paragraph" || type === "heading") allowed.push("textAlign");
  if (type === "paragraph" || type === "heading" || type === "blockquote") {
    allowed.push("nodeTextAlign", "nodeVerticalAlign", "indent");
  }
  if (
    type === "paragraph" ||
    type === "heading" ||
    type === "blockquote" ||
    type === "bulletList" ||
    type === "orderedList" ||
    type === "taskList" ||
    type === "tableCell" ||
    type === "tableHeader"
  ) {
    allowed.push("backgroundColor");
  }
  if (type === "tableCell" || type === "tableHeader") {
    allowed.push("nodeTextAlign", "nodeVerticalAlign", "colspan", "rowspan", "colwidth", "align");
  }
  if (!hasOnlyKeys(value, allowed)) return `${type} contains unsupported attributes.`;
  if (UNIQUE_ID_NODE_TYPES.has(type)) {
    if (typeof value.id !== "string" || !z.string().uuid().safeParse(value.id).success) {
      return `${type} requires a valid unique id.`;
    }
  }
  if (type === "heading" && value.level !== undefined && ![1, 2, 3].includes(Number(value.level))) {
    return "Heading level must be 1, 2, or 3.";
  }
  if (
    type === "orderedList" &&
    value.start !== undefined &&
    (typeof value.start !== "number" || !Number.isInteger(value.start) || value.start < 1)
  ) {
    return "Ordered-list start must be a positive integer.";
  }
  if (
    type === "orderedList" &&
    value.type !== undefined &&
    value.type !== null &&
    (typeof value.type !== "string" || !["1", "a", "A", "i", "I"].includes(value.type))
  ) {
    return "Ordered-list type is invalid.";
  }
  if (type === "taskItem" && typeof value.checked !== "boolean") {
    return "Task items require a checked state.";
  }
  if (
    type === "codeBlock" &&
    value.language !== undefined &&
    value.language !== null &&
    (typeof value.language !== "string" || value.language.length > 80)
  ) {
    return "Code-block language must be a short string or null.";
  }
  for (const key of ["textAlign", "nodeTextAlign"] as const) {
    if (
      value[key] !== undefined &&
      value[key] !== null &&
      (typeof value[key] !== "string" ||
        !["left", "center", "right", "justify"].includes(value[key]))
    ) {
      return `${type} ${key} is invalid.`;
    }
  }
  if (
    value.nodeVerticalAlign !== undefined &&
    value.nodeVerticalAlign !== null &&
    (typeof value.nodeVerticalAlign !== "string" ||
      !["top", "middle", "bottom"].includes(value.nodeVerticalAlign))
  ) {
    return `${type} vertical alignment is invalid.`;
  }
  if (
    value.indent !== undefined &&
    (typeof value.indent !== "number" ||
      !Number.isInteger(value.indent) ||
      value.indent < 0 ||
      value.indent > 8)
  ) {
    return `${type} indent must be an integer from 0 to 8.`;
  }
  if (
    value.backgroundColor !== undefined &&
    value.backgroundColor !== null &&
    !isSafeCssColor(value.backgroundColor)
  ) {
    return `${type} background color is invalid.`;
  }
  if (type === "tableCell" || type === "tableHeader") {
    for (const key of ["colspan", "rowspan"] as const) {
      if (
        typeof value[key] !== "number" ||
        !Number.isInteger(value[key]) ||
        value[key] < 1 ||
        value[key] > 100
      ) {
        return `${type} ${key} must be an integer from 1 to 100.`;
      }
    }
    if (
      value.colwidth !== null &&
      (!Array.isArray(value.colwidth) ||
        value.colwidth.length > Number(value.colspan) ||
        value.colwidth.some(
          (width) =>
            typeof width !== "number" || !Number.isInteger(width) || width < 24 || width > 10_000
        ))
    ) {
      return `${type} column widths are invalid.`;
    }
    if (
      value.align !== undefined &&
      value.align !== null &&
      (typeof value.align !== "string" || !["left", "center", "right"].includes(value.align))
    ) {
      return `${type} alignment is invalid.`;
    }
  }
  return null;
}

function validateLinkMark(mark: Record<string, unknown>): string | null {
  if (!hasOnlyKeys(mark, ["type", "attrs"]) || !isRecord(mark.attrs)) {
    return "Link marks require an attributes object.";
  }
  if (!hasOnlyKeys(mark.attrs, ["href", "target", "rel", "class", "title"])) {
    return "Link marks contain unsupported attributes.";
  }
  const href = mark.attrs.href;
  if (typeof href !== "string" || href.length === 0 || href.length > 2_048) {
    return "Link marks require a valid href.";
  }
  if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href)) {
    return "Link href must use http, https, mailto, tel, a root-relative path, or a fragment.";
  }
  if (
    mark.attrs.target !== undefined &&
    mark.attrs.target !== null &&
    (typeof mark.attrs.target !== "string" || !["_blank", "_self"].includes(mark.attrs.target))
  ) {
    return "Link target must be _blank, _self, or null.";
  }
  for (const key of ["rel", "class", "title"] as const) {
    const value = mark.attrs[key];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return `Link ${key} must be a string or null.`;
    }
  }
  return null;
}

function validateColorMark(mark: Record<string, unknown>): string | null {
  if (
    !hasOnlyKeys(mark, ["type", "attrs"]) ||
    !isRecord(mark.attrs) ||
    !hasOnlyKeys(mark.attrs, ["color"]) ||
    !isSafeCssColor(mark.attrs.color)
  ) {
    return "Text colors must use a supported CSS color value.";
  }
  return null;
}

function isSafeCssColor(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 80) {
    return false;
  }
  return (
    /^#[0-9a-f]{3,8}$/i.test(value) ||
    /^rgba?\([\d\s.,%]+\)$/i.test(value) ||
    /^hsla?\([\d\s.,%]+(?:deg|rad|turn)?\)$/i.test(value) ||
    /^var\(--tt-[a-z0-9-]+\)$/i.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}
