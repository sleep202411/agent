"use client";

import { useEffect, useState } from "react";

/**
 * When running inside an iframe (e.g. studio.test.fizzdragon.com embedded in
 * test.fizzdragon.com), request the satoken from the parent window via
 * postMessage and write it as a cookie so that backend API requests include it.
 *
 * Parent is expected to:
 *  1. Listen for  { type: "requestToken" }
 *  2. Respond with { type: "token", name: "satoken", value: "<token>" }
 *
 * Returns `true` once the token is ready (or immediately if not in an iframe
 * / already has the cookie).
 */

function isInIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}

function setCookie(name: string, value: string, days = 30) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;expires=${expires}`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const TOKEN_NAME = "satoken";
const TIMEOUT_MS = 3000;

export function useIframeToken(): boolean {
  // Always start true to match SSR — avoids hydration mismatch
  const [ready, setReady] = useState(true);

  useEffect(() => {
    if (!isInIframe() || getCookie(TOKEN_NAME)) return;

    // We're in iframe without token — block until parent responds
    setReady(false);

    const timer = setTimeout(() => setReady(true), TIMEOUT_MS);

    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "token" && data.name === TOKEN_NAME && data.value) {
        setCookie(TOKEN_NAME, data.value);
        setReady(true);
        clearTimeout(timer);
      }
    }

    window.addEventListener("message", handleMessage);
    window.parent.postMessage({ type: "requestToken" }, "*");

    return () => {
      window.removeEventListener("message", handleMessage);
      clearTimeout(timer);
    };
  }, []);

  return ready;
}
