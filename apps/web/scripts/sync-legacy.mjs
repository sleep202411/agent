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
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

function fail(msg) {
  console.error(`[sync-legacy] ${msg}`);
  process.exit(1);
}

async function copyDir(srcAbs, dstAbs) {
  await rm(dstAbs, { recursive: true, force: true });
  await mkdir(dstAbs, { recursive: true });
  await cp(srcAbs, dstAbs, { recursive: true });
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

  // Copy index.html verbatim — paths inside (`/assets/...`,
  // `/static/...`) all resolve under the public/ layout we just wrote.
  const html = await readFile(indexSrc, "utf-8");
  const indexDst = resolve(PUBLIC_DIR, "legacy.html");
  await writeFile(indexDst, html, "utf-8");
  console.log(`[sync-legacy] index: ${indexSrc} → ${indexDst}`);

  console.log("[sync-legacy] done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
