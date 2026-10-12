import { z } from "zod";
import bundle from "../script-data/editor-bundle.json";
import {
  scriptEditorMessage,
  scriptHostMessage,
  type ScriptHostMessage,
} from "../../../../script-editor/protocol";
export function parseScriptEditorMessage(raw: unknown, sessionId: string) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = scriptEditorMessage.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.sessionId === sessionId ? parsed.data : null;
  } catch {
    return null;
  }
}
export function scriptHostInjection(message: ScriptHostMessage) {
  const raw = JSON.stringify(scriptHostMessage.parse(message));
  return `window.__fizzScriptReceive?.(${JSON.stringify(raw).replace(/</g, "\\u003c")});true;`;
}
export function scriptEditorHtml(sessionId: string, labels: Record<string, string>) {
  z.string().uuid().parse(sessionId);
  const initial = JSON.stringify({ sessionId, labels }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-script-editor'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>
 :root{color-scheme:dark}body{margin:12px;background:#0b0d12;color:#eee;font:15px/1.6 system-ui;overflow-wrap:anywhere}header{position:sticky;top:0;background:#0b0d12;z-index:2}button{font:inherit;color:inherit;background:#202024;border:1px solid #555;border-radius:6px;padding:8px;margin:3px}button:disabled{opacity:.4}[data-status]{font-size:12px;color:#aaa;margin:8px 0}.tiptap{outline:none;min-height:300px;padding:8px}.tiptap p{min-height:1em}pre{white-space:pre-wrap;background:#202024;padding:8px}blockquote{border-left:2px solid #777;margin:8px;padding-left:12px}h1{font-size:24px}h2{font-size:20px}h3{font-size:17px}a{color:inherit}hr{border:0;border-top:1px solid #555}
 </style></head><body><header><div data-toolbar></div><div data-status role="status"></div></header><main data-editor></main><script data-initial type="application/json">${initial}</script><script nonce="script-editor">${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
