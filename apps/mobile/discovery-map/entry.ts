import { createGpsMap } from "../src/features/discovery-map/content-gps-map-provider";
import { mountMapDocument } from "../src/features/discovery-map/document-runtime";

const params = new URLSearchParams(location.hash.slice(1));
const channel = params.get("channel") ?? "";
const parentOrigin = params.get("parentOrigin");
const native = (window as unknown as { ReactNativeWebView?: { postMessage(value: string): void } })
  .ReactNativeWebView;
// The host document must have a real HTTPS origin for provider key restrictions
// and the same-origin Gaode security proxy. No local-file/opaque-origin fallback.
const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if (
  (location.protocol === "https:" || (local && location.protocol === "http:")) &&
  /^[A-Za-z0-9_-]{20,100}$/.test(channel) &&
  (native || parentOrigin)
) {
  let origin: string | undefined;
  try {
    const value = new URL(parentOrigin ?? "https://invalid.example");
    if (
      value.origin === parentOrigin &&
      (value.protocol === "https:" ||
        (value.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname)))
    )
      origin = value.origin;
  } catch {
    /* Invalid iframe parents receive no messages. */
  }
  if (native || origin) {
    const runtime = mountMapDocument(
      document.getElementById("map")!,
      channel,
      createGpsMap,
      (event) => {
        const data = JSON.stringify({ version: 1, channel, ...event });
        if (native) native.postMessage(data);
        else window.parent.postMessage(data, origin!);
      }
    );
    const receive = (event: MessageEvent) => {
      if (!native && event.source === window.parent && event.origin === origin)
        void runtime.receive(event.data);
    };
    window.addEventListener("message", receive);
    // Native calls this using JSON-serialized data, never interpolated code.
    Object.assign(window, { fizzDiscoveryMapReceive: (raw: unknown) => runtime.receive(raw) });
    window.addEventListener(
      "pagehide",
      () => {
        window.removeEventListener("message", receive);
        runtime.destroy();
      },
      { once: true }
    );
  }
}
