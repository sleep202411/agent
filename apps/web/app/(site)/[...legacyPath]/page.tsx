"use client";

/**
 * Catch-all route for the legacy fizzdragon-web (uni-app H5).
 *
 * Architecture
 * ────────────
 * Every URL that doesn't match a native Next.js page lands here. We
 * render the legacy app inside an iframe so the platform's
 * `(site)/layout.tsx` (GlobalNav + SiteFooter) wraps it natively —
 * users see one consistent header/footer regardless of which side
 * (native vs. legacy) actually serves the page content.
 *
 * The iframe's `src` is `/__legacy/<original-path>`. That URL is
 * rewritten by next.config to `public/legacy.html`, and the legacy
 * bundle (patched by `scripts/sync-legacy.mjs`) calls
 * `history.replaceState` on load to strip the `/__legacy` prefix —
 * so its uni-app history router reads the intended pathname and
 * routes correctly.
 *
 * Outer URL ↔ inner URL drift
 * ───────────────────────────
 * When the user clicks something inside the iframe, the iframe's
 * Vue router pushState changes its OWN URL but the outer browser
 * address bar stays at the entry URL — so deep-linking to a sub-page
 * isn't possible without postMessage syncing between iframe and
 * parent. This is a known limitation; we'll add it when a real
 * deep-link case shows up.
 */

import { use } from "react";

interface Props {
  params: Promise<{ legacyPath?: string[] }>;
}

export default function LegacyCatchAllPage({ params }: Props) {
  const { legacyPath } = use(params);
  const path = legacyPath?.length ? `/${legacyPath.join("/")}` : "/";
  // Iframe src points to the rewrite endpoint that returns legacy.html.
  // The bundle's prefix-stripper script (sync-legacy.mjs) corrects the
  // pathname before its router reads it.
  const src = `/__legacy${path}`;

  return (
    <iframe
      src={src}
      title="Legacy app"
      // Fill the viewport below the platform's pt-16 nav clearance set
      // in `(site)/layout.tsx`. 100vh - 4rem (= 64px navbar height)
      // gives the iframe exactly the remaining viewport. The footer is
      // rendered after the iframe by the layout and pushes the page to
      // scroll naturally if its content overflows.
      className="block w-full border-0"
      style={{ height: "calc(100vh - 4rem)" }}
    />
  );
}
