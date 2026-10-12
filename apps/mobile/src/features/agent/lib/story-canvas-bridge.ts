import { z } from "zod";
import bundle from "../canvas-data/runtime-bundle.json";
import {
  canvasHostMessage,
  canvasRuntimeMessage,
  type CanvasHostMessage,
} from "../../../../canvas-editor/protocol";

export function parseCanvasMessage(raw: unknown, sessionId: string) {
  if (typeof raw !== "string") return null;
  try {
    const parsed = canvasRuntimeMessage.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.sessionId === sessionId ? parsed.data : null;
  } catch {
    return null;
  }
}
export function canvasHostInjection(message: CanvasHostMessage) {
  const raw = JSON.stringify(canvasHostMessage.parse(message));
  return `window.__fizzCanvasReceive?.(${JSON.stringify(raw).replace(/</g, "\\u003c")});true;`;
}
export function canvasRuntimeHtml(sessionId: string) {
  z.string().uuid().parse(sessionId);
  const initial = JSON.stringify({ sessionId }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-canvas-runtime'; base-uri 'none'; form-action 'none'"></head><body><script data-initial type="application/json">${initial}</script><script nonce="canvas-runtime">${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
