import bundle from "./document-data/editor-bundle.json";
import { CrewProductionDocumentSchema } from "./production-document-schema";
export function editorMessage(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 2_100_000) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    if (["ready", "dirty", "error"].includes(value.type) && Object.keys(value).length === 1)
      return { type: value.type as "ready" | "dirty" | "error" };
    if (value.type === "save" && Object.keys(value).length === 2) {
      const parsed = CrewProductionDocumentSchema.safeParse(value.document);
      if (parsed.success) return { type: "save" as const, document: parsed.data };
    }
  } catch {
    /* Invalid messages cannot mutate the document. */
  }
  return null;
}
export function documentEditorHtml(document: unknown, labels: Record<string, string>) {
  const initial = JSON.stringify({
    document: CrewProductionDocumentSchema.parse(document),
    labels,
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-editor'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
 :root{color-scheme:dark}body{margin:12px;background:#0B0D12;color:#EEF0F3;font:16px/1.5 system-ui}button,input{font:inherit;color:inherit;background:#20242C;border:1px solid #687080;border-radius:6px;padding:8px;margin:3px}button:disabled{opacity:.5}details{margin-bottom:8px}summary{cursor:pointer}[data-save]{background:#E52227}header{position:sticky;top:0;background:#0B0D12;z-index:2}.tiptap{outline:none;min-height:300px;padding:8px;overflow-wrap:anywhere}.tiptap p{min-height:1em}.tiptap pre{white-space:pre-wrap;background:#20242C;padding:8px}blockquote{border-left:3px solid #687080;margin:8px;padding-left:12px}table{border-collapse:collapse;min-width:100%}td,th{border:1px solid #687080;min-width:60px;padding:8px}th{background:#20242C}.tableWrapper{overflow:auto}.selectedCell{background:#333843}ul[data-type=taskList]{list-style:none;padding:0}ul[data-type=taskList] li{display:flex;gap:8px}ul[data-type=taskList] li>div{flex:1}a{color:#4D8DFF}
 </style></head><body><main data-production-editor><header><button data-save></button><details><summary>${escapeHtml(labels.format)}</summary><div data-toolbar></div></details><input data-value hidden><button data-apply hidden></button><div data-status role="status"></div></header><div data-editor></div></main><script data-initial type="application/json">${initial}</script><script nonce="editor">${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
