"use client";

import { useEffect } from "react";

/**
 * If a user lands on the studio subdomain (e.g. because the legacy
 * fizzdragon-web bundle still has a stale link, or someone shared a
 * bookmark from a previous architecture), bounce them to the apex
 * domain on the same path. The apex is now the canonical entry point
 * — nginx there proxies to the same studio container, and the
 * satoken cookie lives there host-only, so cross-subdomain landings
 * lose login state.
 *
 * Safe re: API loops:
 * - This is a client-side `window.location.replace`, runs once per
 *   page load after hydration. After the redirect, hostname matches
 *   the apex and the check no-ops.
 * - In-flight `fetch` calls during the brief pre-redirect window
 *   target the studio host's `/api/*` rewrite, which proxies to the
 *   same backend nginx anyway — no host-aware loop.
 *
 * Add new mappings to SUBDOMAIN_TO_APEX as more environments grow.
 */
const SUBDOMAIN_TO_APEX: Record<string, string> = {
  "fizzstudio.fizzdragon.com": "fizzdragon.com",
  "fizzstudio.fizzspace.cn": "fizzdragon.fizzspace.cn",
};

export function ApexRedirect() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const host = window.location.hostname;
    const apex = SUBDOMAIN_TO_APEX[host];
    if (!apex) return;
    const target = `https://${apex}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(target);
  }, []);
  return null;
}
