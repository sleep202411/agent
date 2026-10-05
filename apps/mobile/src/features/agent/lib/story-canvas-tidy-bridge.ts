import { z } from "zod";
import bundle from "../canvas-data/tidy-bundle.json";
export function canvasTidyHtml(sessionId: string) {
  z.string().uuid().parse(sessionId);
  const initial = JSON.stringify({ sessionId }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-canvas-runtime'; worker-src blob:; base-uri 'none'; form-action 'none'"></head><body><script data-initial type="application/json">${initial}</script><script nonce="canvas-runtime">${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
