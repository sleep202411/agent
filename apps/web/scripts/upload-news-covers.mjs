/**
 * One-shot uploader: POSTs each /public/news-static/article-N.jpg to
 *   POST https://fizzdragon.com/content/public/upload/static
 *   form-data: { dir: "pc", file: <File> }
 *
 * Prints a copy-paste ready TS snippet for `_data/static-articles.ts`,
 * so you can swap the local /news-static/* paths for OSS URLs.
 *
 * Run from repo root:
 *   node apps/web/scripts/upload-news-covers.mjs
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "..");

const ENDPOINT = "https://fizzdragon.fizzspace.cn/content/public/upload/static";
/** Public CDN host that serves the uploaded path. */
const PUBLIC_BASE = "https://static.fizzspace.cn";
const COUNT = 10;
const DIR = "pc";

/** Build the public CDN URL from the upstream response shape. */
function extractUrl(payload) {
  if (!payload || typeof payload !== "object") return null;
  // Server returns { code: 200, msg: "success", path: "static/pc/...jpg" }
  if (payload.code === 200 && typeof payload.path === "string") {
    return `${PUBLIC_BASE}/${payload.path.replace(/^\/+/, "")}`;
  }
  return null;
}

async function uploadOne(i) {
  const filePath = join(WEB_ROOT, "public", "news-static", `article-${i}.jpg`);
  const buf = await readFile(filePath);
  const blob = new Blob([buf], { type: "image/jpeg" });

  const form = new FormData();
  form.set("dir", DIR);
  form.set("file", blob, `article-${i}.jpg`);

  // Java backend NPEs without these headers — same pattern as /vedio/project/search.
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "accept-language": "en-US",
      Authorization: "Bearer ",
    },
    body: form,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    console.error(`[${i}] FAIL ${res.status}`, parsed);
    return { id: i, ok: false, raw: parsed };
  }
  const url = extractUrl(parsed);
  console.log(`[${i}] OK  →`, url ?? parsed);
  return { id: i, ok: true, url, raw: parsed };
}

async function main() {
  const results = [];
  for (let i = 1; i <= COUNT; i++) {
    try {
      results.push(await uploadOne(i));
    } catch (err) {
      console.error(`[${i}] ERROR`, err);
      results.push({ id: i, ok: false, error: String(err) });
    }
  }

  console.log("\n──────────────── snippet for static-articles.ts ────────────────");
  for (const r of results) {
    if (r.ok && r.url) {
      console.log(`// article ${r.id}\n"${r.url}",`);
    } else {
      console.log(`// article ${r.id}: FAILED — ${JSON.stringify(r.raw ?? r.error)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
