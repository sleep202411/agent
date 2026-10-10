#!/usr/bin/env node
/**
 * Sync the legacy fizzdragon-web (uni-app H5) build artifact into this
 * Next.js app's `public/` so the merged deploy can serve unmigrated
 * routes without an iframe or a separate origin.
 *
 * Layout we write:
 *
 *     public/
 *       assets/    ← legacy bundle JS/CSS (root-relative refs)
 *       static/    ← legacy `static/*` (favicon, images referenced by
 *                    bundle as `/static/...` — keep the prefix intact
 *                    so we don't have to rewrite minified JS strings)
 *       legacy.html ← legacy `index.html` (verbatim copy)
 *
 * Both `assets/` and `static/` are namespaces the legacy build owns
 * exclusively; platform's own `public/` files all live at root or
 * under `_next/`, so no collisions.
 *
 * Next.js fallback rewrites (next.config.ts) point any unmatched URL
 * at `/legacy.html`; the legacy app's history router takes over on
 * the client and renders the right page.
 *
 * Usage:
 *   node scripts/sync-legacy.mjs
 *
 * Set `LEGACY_DIST` to override the source path:
 *   LEGACY_DIST=/path/to/fizzdragon-web/unpackage/dist/build/web \
 *     node scripts/sync-legacy.mjs
 */

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(HERE, "..");
const PUBLIC_DIR = resolve(WEB_ROOT, "public");

// Default source: sibling repo `fizzdragon-web` checked out next to
// `fizzdragon-platform`. Override via env if your layout differs.
// WEB_ROOT = .../fizzdragon-platform/apps/web → ../../.. = .../fizzdragon
const DEFAULT_SRC = resolve(
  WEB_ROOT,
  "..",
  "..",
  "..",
  "fizzdragon-web",
  "unpackage",
  "dist",
  "build",
  "web"
);
// Sanity: support running from a flatter layout too.
const ALT_SRC = resolve(
  WEB_ROOT,
  "..",
  "..",
  "fizzdragon-web",
  "unpackage",
  "dist",
  "build",
  "web"
);
const LEGACY_DIST = process.env.LEGACY_DIST
  ? resolve(process.env.LEGACY_DIST)
  : existsSync(DEFAULT_SRC)
    ? DEFAULT_SRC
    : ALT_SRC;

const TARGETS = {
  assets: { src: "assets", dst: "assets" },
  static: { src: "static", dst: "static" },
};

// The legacy fizzdragon-web bundle hardcodes `FIZZSTUDIO_URL` /
// `STUDIO_NEW_URL` (and similar) to the host-only studio subdomain
// (e.g. `https://fizzstudio.fizzdragon.com`). When a legacy page
// builds a "go to studio" link with one of these constants, the
// resulting navigation crosses subdomain — and the satoken cookie
// (set on the apex with the host attribute alone) doesn't always
// follow, so the user lands on the studio host unauthenticated and
// gets bounced to /login. Since the platform now serves the same
// app from the apex via nginx proxy, we patch the bundle to point
// these constants back at the apex on every sync.
const FIZZSTUDIO_REWRITES = [
  ["https://fizzstudio.fizzdragon.com", "https://fizzdragon.com"],
  ["https://fizzstudio.fizzspace.cn", "https://fizzdragon.fizzspace.cn"],
];

function fail(msg) {
  console.error(`[sync-legacy] ${msg}`);
  process.exit(1);
}

async function copyDir(srcAbs, dstAbs) {
  await rm(dstAbs, { recursive: true, force: true });
  await mkdir(dstAbs, { recursive: true });
  await cp(srcAbs, dstAbs, { recursive: true });
}

/**
 * Rewrite hardcoded cross-subdomain studio URLs inside the bundle's JS
 * chunks back to the apex domain. See FIZZSTUDIO_REWRITES for the rule.
 */
async function rewriteCrossSubdomainUrls(assetsDir) {
  if (!existsSync(assetsDir)) return;
  const entries = await readdir(assetsDir);
  for (const entry of entries) {
    if (!entry.endsWith(".js") && !entry.endsWith(".css")) continue;
    const file = resolve(assetsDir, entry);
    let content;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    let changed = false;
    for (const [from, to] of FIZZSTUDIO_REWRITES) {
      if (content.includes(from)) {
        content = content.split(from).join(to);
        changed = true;
      }
    }
    if (changed) {
      await writeFile(file, content, "utf-8");
      console.log(`[sync-legacy] rewrote cross-subdomain URLs in assets/${entry}`);
    }
  }
}

async function main() {
  if (!existsSync(LEGACY_DIST)) {
    fail(
      `legacy build not found at ${LEGACY_DIST}\n` +
        `Run \`npm run build\` in fizzdragon-web first, or set LEGACY_DIST=...`
    );
  }
  const indexSrc = resolve(LEGACY_DIST, "index.html");
  if (!existsSync(indexSrc)) {
    fail(`legacy index.html missing at ${indexSrc}`);
  }

  console.log(`[sync-legacy] source: ${LEGACY_DIST}`);
  console.log(`[sync-legacy] target: ${PUBLIC_DIR}`);

  // Copy index.html with a small `<style>` injection that hides the
  // legacy fizzdragon-web's own AppLayout navbar + footer. The platform
  // is the only consumer of this bundle now (strangler-fig), so legacy
  // pages should render as bare content; users navigate via the platform
  // chrome on native Next.js routes.
  //
  // Selectors come from the compiled scoped CSS:
  //   data-v-7f5ea766 → AppLayout navbar component
  //                     (.pc-navbar / .navbar-fixed / .mobile-menu-overlay …)
  //   data-v-c2d26263 → AppLayout footer component
  //                     (.footer-container)
  // Using attribute selectors catches every element in those components,
  // which is what we want — the whole subtree should disappear.
  //
  // !important defends against the bundle's own `display: flex` rules
  // that would otherwise win on the wrappers due to specificity ties.
  const html = await readFile(indexSrc, "utf-8");

  // 1) Hide the legacy AppLayout navbar + footer. The platform is the
  //    only consumer of this bundle now (strangler-fig), and the
  //    legacy page in `app/(site)/pages/course/course/page.tsx` wraps
  //    legacy content with the platform's GlobalNav + SiteFooter via
  //    iframe — so legacy's own chrome would just duplicate.
  //
  //    Selectors come from the compiled scoped CSS:
  //      data-v-7f5ea766 → AppLayout navbar component
  //      data-v-c2d26263 → AppLayout footer component
  const HIDE_CHROME_STYLE = `
    <style id="fizz-legacy-hide-chrome">
      [data-v-7f5ea766] { display: none !important; }
      [data-v-c2d26263] { display: none !important; }
    </style>
  `;

  // 2) Strip the `/__legacy` URL prefix BEFORE the legacy bundle loads.
  //    next.config rewrites `/__legacy/:path*` → `/legacy.html`, so the
  //    iframe's window.location.pathname looks like
  //    `/__legacy/pages/foo`. The legacy uni-app history router reads
  //    pathname directly and doesn't know about our prefix — without
  //    this rewrite it routes to `/__legacy/pages/foo` and 404s.
  //
  //    history.replaceState fires synchronously and updates pathname
  //    to `/pages/foo` before the bundle's main script even parses.
  //    Wrapped in a try/catch because `replaceState` can throw under
  //    sandboxed iframe edge cases — better to fall through with the
  //    raw URL than block the whole page.
  const STRIP_LEGACY_PREFIX_SCRIPT = `
    <script>
      (function () {
        try {
          var p = window.location.pathname;
          var prefix = "/__legacy";
          if (p.indexOf(prefix) === 0) {
            var rest = p.slice(prefix.length) || "/";
            window.history.replaceState(
              null,
              "",
              rest + window.location.search + window.location.hash
            );
          }
        } catch (err) {
          /* eslint-disable-next-line no-console */
          console.warn("[fizz-legacy] could not strip /__legacy prefix:", err);
        }
      })();
    </script>
  `;

  // The strip script must run BEFORE the bundle script tag is even
  // parsed — otherwise the legacy bundle's router could observe the
  // wrong pathname during its early init. Inject it right after the
  // opening <head> tag so it's the first thing the parser sees.
  // The hide-chrome style is order-insensitive; append it before
  // </head>.
  let patched = html.replace(/<head>/i, `<head>${STRIP_LEGACY_PREFIX_SCRIPT}`);
  if (patched === html) {
    fail(`could not find <head> tag in ${indexSrc} — refusing to write legacy.html without prefix-stripper`);
  }
  patched = patched.replace(/<\/head>/i, `${HIDE_CHROME_STYLE}</head>`);
  // Validate and prepare the HTML before replacing any installed assets.
  // Copy the two asset trees. We blow away the destination first so
  // stale files from a previous build don't accumulate.
  for (const [label, { src, dst }] of Object.entries(TARGETS)) {
    const srcAbs = resolve(LEGACY_DIST, src);
    const dstAbs = resolve(PUBLIC_DIR, dst);
    if (!existsSync(srcAbs)) {
      console.warn(`[sync-legacy] ${label}: source missing (${srcAbs}) — skipping`);
      continue;
    }
    await copyDir(srcAbs, dstAbs);
    console.log(`[sync-legacy] ${label}: ${srcAbs} → ${dstAbs}`);
  }

  // Patch step: rewrite hardcoded `https://fizzstudio.<env>` URLs in
  // the just-copied asset chunks back to the apex. The legacy bundle
  // builds links from these constants and would otherwise navigate the
  // user across subdomain (where the satoken cookie may not follow).
  await rewriteCrossSubdomainUrls(resolve(PUBLIC_DIR, TARGETS.assets.dst));

  const indexDst = resolve(PUBLIC_DIR, "legacy.html");
  await writeFile(indexDst, patched, "utf-8");
  console.log(`[sync-legacy] index: ${indexSrc} → ${indexDst} (chrome hidden, prefix stripper injected)`);

  console.log("[sync-legacy] done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
