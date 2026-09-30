import { CrewProductionDocumentSchema } from "./production-document-schema";

type Node = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: Node[];
};
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );

/** Offline rendering only. Document links remain selectable references, never embedded navigation. */
export function productionDocumentHtml(value: unknown): string {
  const document = CrewProductionDocumentSchema.parse(value);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
  :root{color-scheme:dark}body{margin:16px;background:#0B0D12;color:#EEF0F3;font:16px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}p{min-height:1em;white-space:pre-wrap}h1{font-size:1.6em}h2{font-size:1.4em}h3{font-size:1.2em}blockquote{margin:12px 0;padding-left:16px;border-left:3px solid #687080}pre{overflow:auto;padding:12px;background:#20242C;border-radius:8px;white-space:pre}code{font-family:monospace;background:#20242C}table{border-collapse:collapse;min-width:100%}td,th{border:1px solid #687080;padding:8px;min-width:80px}th{background:#20242C}.table{overflow-x:auto}ul.tasks{list-style:none;padding-left:16px}.reference{color:#9098A7;font-size:.85em}hr{border:0;border-top:1px solid #687080}
  </style></head><body>${(document.content as Node[]).map(render).join("")}</body></html>`;
}
function render(node: Node): string {
  const a = node.attrs ?? {};
  if (node.type === "text") return (node.marks ?? []).reduce(mark, escape(node.text));
  if (node.type === "hardBreak") return "<br>";
  if (node.type === "emoji") return escape(`:${a.name}:`);
  const children = (node.content ?? []).map(render).join("");
  const styles: string[] = [];
  const align = a.nodeTextAlign ?? a.textAlign ?? a.align;
  if (align) styles.push(`text-align:${align}`);
  if (a.nodeVerticalAlign) styles.push(`vertical-align:${a.nodeVerticalAlign}`);
  if (a.indent) styles.push(`padding-inline-start:${Number(a.indent) * 24}px`);
  if (a.backgroundColor) styles.push(`background-color:${a.backgroundColor}`);
  if (Array.isArray(a.colwidth) && a.colwidth.length)
    styles.push(`width:${a.colwidth.reduce((sum: number, width: number) => sum + width, 0)}px`);
  const style = styles.length ? ` style="${escape(styles.join(";"))}"` : "";
  const tags: Record<string, string> = {
    paragraph: "p",
    heading: `h${Number(a.level ?? 1)}`,
    blockquote: "blockquote",
    bulletList: "ul",
    orderedList: "ol",
    listItem: "li",
    taskList: "ul",
    taskItem: "li",
    table: "table",
    tableRow: "tr",
    tableCell: "td",
    tableHeader: "th",
    codeBlock: "pre",
  };
  if (node.type === "horizontalRule") return "<hr>";
  const tag = tags[node.type];
  if (!tag) throw new Error("Unsupported production document node.");
  let attrs = style;
  if (node.type === "orderedList")
    attrs += ` start="${escape(a.start ?? 1)}" type="${escape(a.type ?? "1")}"`;
  if (node.type === "taskList") attrs += ' class="tasks"';
  if (node.type === "tableCell" || node.type === "tableHeader")
    attrs += ` colspan="${a.colspan}" rowspan="${a.rowspan}"`;
  const content =
    node.type === "taskItem"
      ? `${a.checked ? "☑" : "☐"} ${children}`
      : node.type === "codeBlock"
        ? `<code>${children}</code>`
        : children;
  const html = `<${tag}${attrs}>${content}</${tag}>`;
  return node.type === "table" ? `<div class="table">${html}</div>` : html;
}
function mark(text: string, mark: Node): string {
  const tags: Record<string, string> = {
    bold: "strong",
    italic: "em",
    underline: "u",
    strike: "s",
    code: "code",
    superscript: "sup",
    subscript: "sub",
  };
  const tag = tags[mark.type];
  if (tag) return `<${tag}>${text}</${tag}>`;
  if (mark.type === "link")
    return `<u>${text}</u><span class="reference"> (${escape(mark.attrs?.href)})</span>`;
  if (mark.type === "textStyle" || mark.type === "highlight")
    return `<span style="${mark.type === "highlight" ? "background-color" : "color"}:${escape(mark.attrs?.color)}">${text}</span>`;
  throw new Error("Unsupported production document mark.");
}
