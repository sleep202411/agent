"use client";

import { useEffect, useRef, useState } from "react";
import type { SeedMessage, StudioSeed } from "@/src/types/studio-seed";

/**
 * On mount the hook asks the parent window (fizzdragon-web / workspace.vue)
 * whether there is a studio-composer seed waiting for this page load.
 *
 * Protocol:
 *   - iframe → parent: { type: "requestSeed" }
 *   - parent → iframe: { type: "seed", payload: StudioSeed | null }
 *   - iframe → parent: { type: "ackSeed" }          (only on non-null payload)
 *                      — parent then clears its sessionStorage.
 *
 * Parent does NOT consume the seed on the first requestSeed because
 * React StrictMode / iframe re-mounts can fire multiple requests and
 * the very first reply often races with listener cleanup. Keeping it
 * until ack guarantees at-least-once delivery; the `gotRef` flag below
 * ensures we apply the payload at-most-once.
 */
export function useStudioSeed(): { seed: StudioSeed | null; ready: boolean } {
  const [seed, setSeed] = useState<StudioSeed | null>(null);
  const [ready, setReady] = useState(false);
  const gotRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.self === window.top) {
      // 独立访问（非 iframe 嵌入），不会有 seed
      console.info("[studio-seed] standalone mode — no seed expected");
      setReady(true);
      return;
    }

    const timer = setTimeout(() => {
      if (!gotRef.current) {
        console.info("[studio-seed] timed out waiting for seed (2s)");
        setReady(true);
      }
    }, 2000);

    function handleMessage(event: MessageEvent) {
      const data = event.data as SeedMessage | undefined;
      if (!data || typeof data !== "object") return;
      if (data.type !== "seed") return;

      if (data.payload) {
        if (gotRef.current) return; // already applied; ignore dupes
        gotRef.current = true;
        console.info("[studio-seed] received", data.payload);
        setSeed(data.payload);
        setReady(true);
        clearTimeout(timer);
        // Tell parent it's safe to drop the stashed seed
        window.parent.postMessage({ type: "ackSeed" }, "*");
      } else {
        // null means parent has nothing (stale reply or we've already acked);
        // don't clobber an already-applied seed.
        console.info("[studio-seed] received null");
        if (!gotRef.current) setReady(true);
      }
    }

    window.addEventListener("message", handleMessage);
    console.info("[studio-seed] posting requestSeed to parent");
    window.parent.postMessage({ type: "requestSeed" }, "*");

    return () => {
      window.removeEventListener("message", handleMessage);
      clearTimeout(timer);
    };
  }, []);

  return { seed, ready };
}
