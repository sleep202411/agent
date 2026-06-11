/**
 * Loads hardcoded news articles from per-locale markdown files.
 *
 * Each article folder under `articles/<dir>/` contains:
 *   en-US.md   (required — canonical source)
 *   zh-CN.md   (optional — falls back to en-US)
 *   zh-HK.md   (optional — falls back to zh-CN, then en-US)
 *
 * Each .md file uses YAML-ish frontmatter:
 *   ---
 *   title: ...
 *   summary: ...
 *   ---
 *   # body markdown
 *
 * SERVER-ONLY: this module uses `node:fs` and is consumed by the
 * server-side data layer in `_data/news.ts`. Don't import it from a
 * client component.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARTICLE_MANIFEST, type ArticleMeta } from "./articles/manifest";
import type { NewsItem } from "./types";

type LocaleKey = "en-US" | "zh-CN" | "zh-HK";

const ARTICLES_ROOT = join(process.cwd(), "app", "(site)", "news", "_data", "articles");

/** Tiny YAML-ish frontmatter parser — no nesting, only quoted strings. */
function parseFrontmatter(raw: string): { title: string; summary: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { title: "", summary: "", body: raw.trim() };

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Strip surrounding quotes (single or double) and unescape \" sequences.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
    }
    meta[m[1]] = value;
  }

  return {
    title: meta.title ?? "",
    summary: meta.summary ?? "",
    body: match[2].trim(),
  };
}

/** Cache parsed files by absolute path — articles are static at build time. */
const fileCache = new Map<string, { title: string; summary: string; body: string } | null>();

function loadFile(path: string) {
  const cached = fileCache.get(path);
  if (cached !== undefined) return cached;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = parseFrontmatter(raw);
    fileCache.set(path, parsed);
    return parsed;
  } catch {
    fileCache.set(path, null);
    return null;
  }
}

function loadWithFallback(meta: ArticleMeta, lang: LocaleKey) {
  const tryLangs: LocaleKey[] =
    lang === "zh-HK"
      ? ["zh-HK", "zh-CN", "en-US"]
      : lang === "zh-CN"
        ? ["zh-CN", "en-US"]
        : ["en-US"];
  for (const candidate of tryLangs) {
    const path = join(ARTICLES_ROOT, meta.dir, `${candidate}.md`);
    const file = loadFile(path);
    if (file) return file;
  }
  return null;
}

export function getStaticArticles(rawLang: string): NewsItem[] {
  const lang: LocaleKey =
    rawLang === "zh-HK" || rawLang === "zh-CN" || rawLang === "en-US" ? rawLang : "en-US";

  const items: NewsItem[] = [];
  for (const meta of ARTICLE_MANIFEST) {
    const file = loadWithFallback(meta, lang);
    if (!file) continue;
    items.push({
      id: meta.id,
      type: "article",
      title: file.title,
      info: file.summary,
      cover: meta.cover,
      createTime: new Date(meta.publishedAt).toISOString(),
      isExternal: false,
      body: file.body,
      slug: meta.slug,
      author: meta.author,
      category: meta.category,
    });
  }
  return items;
}

/** Back-compat default — English copy. Prefer `getStaticArticles(lang)`. */
export const STATIC_ARTICLES: NewsItem[] = getStaticArticles("en-US");
