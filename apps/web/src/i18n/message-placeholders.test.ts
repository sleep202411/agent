/**
 * Every `{placeholder}` a message uses must be supplied by the call site
 * that renders it — in **every** locale, not just the one the author
 * happened to read.
 *
 * i18next is configured here with single-brace interpolation
 * (`i18n.ts` overrides the `{{…}}` default), and a variable it cannot
 * resolve is left in the output verbatim. So a Chinese translation that
 * leads with a count the English string does not use —
 * `"本集仍有 {pending} 项未完成…"` against
 * `t("approveEpisodeWarnTitle", { number })` — ships a literal
 * `{pending}` to every zh-CN reader while en-US looks perfect. Nothing
 * else catches it: `tsc` types `t()` as `(key: string, params?) =>
 * string`, and the key-parity test deliberately refuses to compare
 * placeholders because call sites are allowed to pass a *superset* of
 * interpolation values for locale-specific phrasing.
 *
 * Only the missing direction is a bug, and that is what this asserts.
 *
 * ── How it reads the code ────────────────────────────────────
 * A regex pass, not a type checker. It resolves `t("key")` against the
 * nearest preceding `const t = useTranslations("ns")` above it, and
 * counts a placeholder as supplied when it appears either as a key of
 * the literal options object or in a `.replace("{x}", …)` chained onto
 * the call (an idiom the storyboard canvas uses throughout).
 *
 * Anything it cannot resolve with confidence — a computed key, a `t`
 * received as a prop, a spread options object, a key absent from the
 * reference catalog — is skipped rather than guessed at, so the suite
 * stays free of false alarms at the cost of some coverage. The
 * `SCANNED_AT_LEAST` floor keeps that escape hatch from quietly
 * swallowing the whole codebase if the source layout changes.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import i18n from "./i18n";

const CATALOGS: Record<string, unknown> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "zh-HK": zhHK,
};
const REFERENCE_LOCALE = "en-US";

/** `import.meta.url` is an http URL under the jsdom environment, so the
 *  app root comes from the working directory instead — vitest runs with
 *  its config's root as cwd, and `apps/web` covers a run started one
 *  level up. */
function resolveAppRoot(): string {
  for (const candidate of [process.cwd(), join(process.cwd(), "apps", "web")]) {
    if (existsSync(join(candidate, "messages", "en-US.json"))) return candidate;
  }
  throw new Error(`cannot locate apps/web from ${process.cwd()}`);
}

/** Directories holding `useTranslations` call sites. */
const APP_ROOT = resolveAppRoot();
const SOURCE_DIRS = ["app", "components", "src"];
const SKIP_DIRS = new Set(["node_modules", ".next", "public"]);

/** Tripwire for the skip logic silently eating everything. The real
 *  count is in the thousands; this only has to notice a collapse. */
const SCANNED_AT_LEAST = 2000;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function messageAt(catalog: unknown, dottedKey: string): string | undefined {
  let node: unknown = catalog;
  for (const segment of dottedKey.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : undefined;
}

function placeholdersIn(message: string): string[] {
  return [...message.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
}

/** Keys of the object literal starting at `open`, or null when the
 *  literal is not statically readable (spread, computed key). */
function objectLiteralKeys(source: string, open: number): Set<string> | null {
  let depth = 0;
  let end = open;
  for (; end < source.length; end++) {
    if (source[end] === "{") depth++;
    else if (source[end] === "}" && --depth === 0) break;
  }
  if (depth !== 0) return null;
  const inner = source.slice(open + 1, end);
  if (inner.includes("...")) return null;

  const names = new Set<string>();
  let nesting = 0;
  let current = "";
  for (const char of `${inner},`) {
    if ("{[(".includes(char)) nesting++;
    if ("}])".includes(char)) nesting--;
    if (char === "," && nesting === 0) {
      const property = current.trim();
      current = "";
      if (!property) continue;
      const name = /^([A-Za-z0-9_$]+)\s*(:|$)/.exec(property);
      if (!name) return null;
      names.add(name[1]);
    } else {
      current += char;
    }
  }
  return names;
}

interface CallSite {
  file: string;
  key: string;
  supplied: Set<string>;
}

function callSitesIn(file: string): { sites: CallSite[]; skipped: number } {
  const source = readFileSync(file, "utf8");
  const sites: CallSite[] = [];
  let skipped = 0;
  if (!source.includes("useTranslations")) return { sites, skipped };

  const bindings = [
    ...source.matchAll(
      /(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*useTranslations\(\s*"([^"]+)"\s*\)/g
    ),
  ].map((m) => ({ at: m.index, name: m[1], namespace: m[2] }));
  if (bindings.length === 0) return { sites, skipped };

  const names = [...new Set(bindings.map((b) => b.name))]
    .map((name) => name.replaceAll("$", "\\$"))
    .join("|");
  const calls = source.matchAll(new RegExp(`\\b(${names})\\(\\s*"([^"]+)"\\s*(,|\\))`, "g"));

  for (const call of calls) {
    const [matched, variable, key, delimiter] = call;
    const binding = bindings.findLast((b) => b.name === variable && b.at < call.index);
    if (!binding) {
      skipped++;
      continue;
    }
    const dotted = `${binding.namespace}.${key}`;
    if (messageAt(CATALOGS[REFERENCE_LOCALE], dotted) === undefined) {
      // `t` shadowed by a prop, or a key this scan resolved to the
      // wrong namespace — either way, not ours to judge.
      skipped++;
      continue;
    }

    const afterCall = call.index + matched.length;
    let supplied = new Set<string>();
    if (delimiter === ",") {
      if (!source.slice(afterCall).trimStart().startsWith("{")) {
        skipped++;
        continue;
      }
      const keys = objectLiteralKeys(source, source.indexOf("{", afterCall - 1));
      if (!keys) {
        skipped++;
        continue;
      }
      supplied = keys;
    }
    // `t("key").replace("{x}", …)` fills the slot just as well.
    for (const chained of source
      .slice(call.index, afterCall + 400)
      .matchAll(/\.replace\(\s*"\{([A-Za-z0-9_]+)\}"/g)) {
      supplied.add(chained[1]);
    }
    sites.push({ file: file.slice(APP_ROOT.length), key: dotted, supplied });
  }
  return { sites, skipped };
}

const scanned = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(APP_ROOT, dir))).map(callSitesIn);
const callSites = scanned.flatMap((r) => r.sites);

describe("message placeholders", () => {
  it.each(Object.keys(CATALOGS))("uses the configured single-brace syntax in %s", (locale) => {
    expect(JSON.stringify(CATALOGS[locale])).not.toMatch(/\{\{[A-Za-z0-9_]+\}\}/);
  });

  it.each(Object.keys(CATALOGS))("interpolates missing task fields in %s", (locale) => {
    const message = i18n.t("crewTasks.requiredTaskFields", {
      lng: locale,
      fields: "Deadline, Reward",
    });
    expect(message).toContain("Deadline, Reward");
    expect(message).not.toMatch(/[{}]/);
  });

  it("resolves the bulk of the app's translation call sites", () => {
    expect(callSites.length).toBeGreaterThan(SCANNED_AT_LEAST);
  });

  it("has every placeholder supplied by its call site, in every locale", () => {
    const unmet: string[] = [];
    for (const site of callSites) {
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        const message = messageAt(catalog, site.key);
        if (message === undefined) continue; // key parity is its own test
        const missing = placeholdersIn(message).filter((name) => !site.supplied.has(name));
        if (missing.length > 0) {
          unmet.push(
            `${site.key} renders literal {${[...new Set(missing)].join("}, {")}} in ${locale} — ${site.file}`
          );
        }
      }
    }

    expect([...new Set(unmet)].sort()).toEqual([]);
  });
});
