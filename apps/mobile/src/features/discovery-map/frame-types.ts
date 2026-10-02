import type { Ref } from "react";
export type MapFrameHandle = { send(raw: string): void };
export type MapFrameProps = {
  ref?: Ref<MapFrameHandle>;
  url: string;
  channel: string;
  title: string;
  onMessage(raw: unknown): void;
  onError(): void;
};
export function documentUrl(url: string, channel: string, parentOrigin?: string) {
  const value = new URL(url);
  value.hash = new URLSearchParams({
    channel,
    ...(parentOrigin ? { parentOrigin } : {}),
  }).toString();
  return value.href;
}
export function injection(raw: string) {
  const literal = JSON.stringify(raw)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.fizzDiscoveryMapReceive && window.fizzDiscoveryMapReceive(${literal}); true;`;
}

/** Provider legal/attribution links only; never interpret these as app routes. */
export function safeMapAttributionUrl(raw: string) {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        "maps.google.com",
        "www.google.com",
        "policies.google.com",
        "lbs.amap.com",
        "www.amap.com",
        "ditu.amap.com",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
