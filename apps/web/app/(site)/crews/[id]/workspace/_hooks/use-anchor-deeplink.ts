"use client";

import { useEffect, useRef } from "react";

/**
 * How long to keep watching for a deeplinked anchor before giving up.
 * A link to a row that no longer exists (episode deleted, viewer lost
 * access) must not leave a document-wide MutationObserver attached for
 * the life of the page.
 */
const ANCHOR_WAIT_MS = 10_000;

/**
 * Scroll a deeplinked row into view as soon as it exists.
 *
 * Crew notifications point at a row rather than a page:
 * `?tab=episodes&episode=<e>&assignment=<a>` targets
 * `#assignment-row-<a>`, which the board renders *inside*
 * `#episode-row-<e>`. Neither is in the document on first paint, and
 * they arrive at different moments — the episode row with the episodes
 * query, the assignment row only once that row is expanded and its own
 * assignments query resolves.
 *
 * So `anchorIds` is an ordered candidate list, most specific first —
 * see `_lib/deeplink-anchors`, which owns the ids and their order. The
 * hook scrolls to the best candidate currently in the document and
 * upgrades once a better one appears, which also means a link to an
 * assignment that has since been unassigned still lands the reader on
 * its episode instead of stranding them at the top of the page.
 *
 * Watching stops as soon as the best candidate is reached, and in any
 * case after `ANCHOR_WAIT_MS`.
 *
 * Consumption is tracked per candidate list, not as a boolean: a second
 * notification opened from the live toast while the workspace is still
 * mounted changes the ids and must scroll again.
 *
 * Pass an empty list when there is nothing to scroll to (no deeplink, or
 * the reader has since switched to a tab that renders no anchor).
 */
export function useAnchorDeeplink(anchorIds: readonly string[]): void {
  // A fresh array every render can't be an effect dependency, so the
  // effect keys off the joined ids instead. Anchor ids are url-derived
  // opaque strings; "\n" cannot occur in one.
  const key = anchorIds.filter((id) => id).join("\n");
  // `rank` is the index in the candidate list of the anchor we last
  // scrolled to — lower is better, `Infinity` means "nothing yet".
  const consumedRef = useRef<{ key: string; rank: number }>({ key: "", rank: Infinity });

  useEffect(() => {
    if (!key) return;
    const ids = key.split("\n");
    if (consumedRef.current.key !== key) consumedRef.current = { key, rank: Infinity };
    if (consumedRef.current.rank === 0) return;

    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const tryScroll = () => {
      const rank = ids.findIndex((id) => document.getElementById(id));
      if (rank === -1 || rank >= consumedRef.current.rank) return;
      const el = document.getElementById(ids[rank]!)!;
      consumedRef.current = { key, rank };
      // Nothing can beat the most specific anchor — stop watching.
      if (rank === 0) stop();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    tryScroll();
    if (consumedRef.current.rank === 0) return;

    observer = new MutationObserver(tryScroll);
    observer.observe(document.body, { childList: true, subtree: true });
    timer = setTimeout(stop, ANCHOR_WAIT_MS);

    return stop;
  }, [key]);
}
