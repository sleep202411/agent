import { z } from "zod";
import bundle from "./data/runtime-bundle.json";
import { worldCommandSchema, type WorldCommand } from "../../../../world-player/protocol";

export function worldRuntimeInjection(message: WorldCommand) {
  const raw = JSON.stringify(worldCommandSchema.parse(message));
  return `window.__fizzWorldReceive?.(${JSON.stringify(raw).replace(/</g, "\\u003c")});true;`;
}
export function worldRuntimeHtml(sessionId: string, resumeLabel = "Resume") {
  z.string().uuid().parse(sessionId);
  const label = resumeLabel.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!
  );
  const initial = JSON.stringify({ sessionId }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-world-player'; connect-src https: wss:; media-src blob: https:; worker-src blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}video{display:block;width:100%;height:100%;object-fit:contain}button{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-height:44px;padding:12px 20px;border:1px solid #555;border-radius:8px;background:#141414;color:white;font:600 14px system-ui}button[hidden]{display:none}</style></head><body><video playsinline></video><button data-resume type="button" hidden>${label}</button><script data-initial type="application/json">${initial}</script><script nonce="world-player">${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
