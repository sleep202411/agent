import { describe, expect, it } from "vitest";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";

/**
 * The three catalogs must describe exactly the same key space.
 *
 * Neither direction of drift is visible without this test. A key
 * missing from zh-CN silently falls back to the en-US string, so a
 * Chinese reader gets an English sentence inside an otherwise
 * translated page and nothing anywhere reports it. A key that exists
 * only in a translation is dead weight that survives every refactor
 * because no call site references it. `tsc` cannot see either case:
 * `useTranslations` takes a plain string key.
 *
 * Two tempting stronger assertions are wrong here and must not be
 * added:
 *
 *   - Placeholder equality. Interpolation is single-brace (`{percent}`
 *     — see i18n.ts, which overrides i18next's `{{…}}` default) and
 *     some call sites supply a superset on purpose so locales can choose
 *     different interpolation values for natural phrasing.
 *   - Non-empty values. `quota.unit.image` and friends are blank in
 *     en-US by design — English pluralises the noun ("12 images")
 *     where Chinese appends a measure word ("12 张").
 */
const CATALOGS: Record<string, unknown> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "zh-HK": zhHK,
};

const REFERENCE_LOCALE = "en-US";

/** Dotted path → value for every leaf. Nested namespaces are the norm
 *  here (`home.madeWithFizz.inProduction`), so a top-level diff of
 *  `Object.keys` would miss almost all of the catalog. */
function leaves(value: unknown, prefix = "", out: [string, unknown][] = []): [string, unknown][] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      leaves(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.push([prefix, value]);
  return out;
}

const keysOf = (locale: string) =>
  leaves(CATALOGS[locale])
    .map(([key]) => key)
    .sort();

const reference = keysOf(REFERENCE_LOCALE);

describe("message catalogs", () => {
  it("has a non-trivial reference catalog", () => {
    // Guards the assertions below against a mangled import silently
    // comparing two empty sets.
    expect(reference.length).toBeGreaterThan(100);
  });

  it.each(Object.keys(CATALOGS).filter((locale) => locale !== REFERENCE_LOCALE))(
    "%s has exactly the same keys as en-US",
    (locale) => {
      const keys = keysOf(locale);
      const missing = reference.filter((key) => !keys.includes(key));
      const extra = keys.filter((key) => !reference.includes(key));

      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    }
  );

  it.each(Object.keys(CATALOGS))("%s holds a string at every leaf", (locale) => {
    // A number or array leaf does not survive `t(key)` — i18next hands
    // back something React renders as `[object Object]` or drops.
    const wrong = leaves(CATALOGS[locale])
      .filter(([, value]) => typeof value !== "string")
      .map(([key]) => key);

    expect(wrong).toEqual([]);
  });
});
