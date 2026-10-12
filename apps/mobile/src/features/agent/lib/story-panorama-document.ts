import bundle from "../canvas-data/panorama-bundle.json";
export type PanoramaLabels = Record<
  "title" | "left" | "right" | "up" | "down" | "zoomIn" | "zoomOut" | "reset" | "hint",
  string
>;
const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
export function panoramaDocument(sessionId: string, src: string, labels: PanoramaLabels) {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(src))
    throw Error("Invalid panorama image bytes.");
  const data = JSON.stringify({ sessionId, src }).replace(/</g, "\\u003c");
  const symbols = {
    left: "←",
    right: "→",
    up: "↑",
    down: "↓",
    zoomIn: "+",
    zoomOut: "−",
    reset: "↺",
  };
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><style>html,body{margin:0;height:100%;background:#090909;color:#eee;font:14px system-ui}body{display:flex;flex-direction:column}canvas{flex:1;min-height:0;width:100%;touch-action:none;outline-offset:-3px}footer{padding:8px}p{margin:0 0 8px;color:#aaa;font-size:12px}nav{display:flex;justify-content:space-between;gap:2px}button{min-width:40px;min-height:44px;background:#202020;border:0;border-radius:6px;color:#eee;font-size:18px}button:focus-visible{outline:2px solid #E52227}[data-status]{font-variant-numeric:tabular-nums;display:block;margin:8px 0 0;color:#aaa;font-size:12px}</style></head><body><canvas tabindex="0" aria-label="${escape(labels.title)}" aria-describedby="hint"></canvas><footer><p id="hint">${escape(labels.hint)}</p><nav>${Object.entries(
    symbols
  )
    .map(
      ([key, symbol]) =>
        `<button data-action="${key}" aria-label="${escape(labels[key as keyof typeof symbols])}">${symbol}</button>`
    )
    .join(
      ""
    )}</nav><span data-status></span></footer><script type="application/json" data-initial>${data}</script><script>${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
export type PanoramaFrameProps = {
  html: string;
  title: string;
  sessionId: string;
  onEvent(type: "loaded" | "error", detail?: string): void;
};
export function readPanoramaEvent(raw: unknown, sessionId: string) {
  try {
    const event = typeof raw === "string" ? JSON.parse(raw) : null;
    return event?.sessionId === sessionId &&
      ["loaded", "error"].includes(event.type) &&
      (event.detail === undefined || typeof event.detail === "string")
      ? (event as { type: "loaded" | "error"; detail?: string })
      : null;
  } catch {
    return null;
  }
}
