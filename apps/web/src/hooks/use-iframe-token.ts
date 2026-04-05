"use client";

import { useEffect, useSyncExternalStore, useState } from "react";

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
  const needsToken = useSyncExternalStore(
    () => () => {},
    () => isInIframe() && !getCookie(TOKEN_NAME),
    () => false
  );

  const [tokenReceived, setTokenReceived] = useState(false);

  useEffect(() => {
    if (!needsToken) return;

    const timer = setTimeout(() => setTokenReceived(true), TIMEOUT_MS);

    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "token" && data.name === TOKEN_NAME && data.value) {
        setCookie(TOKEN_NAME, data.value);
        setTokenReceived(true);
        clearTimeout(timer);
      }
    }

    window.addEventListener("message", handleMessage);
    window.parent.postMessage({ type: "requestToken" }, "*");

    return () => {
      window.removeEventListener("message", handleMessage);
      clearTimeout(timer);
    };
  }, [needsToken]);

  return !needsToken || tokenReceived;
}
