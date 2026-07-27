import { describe, expect, it } from "vitest";
import { AUTH_TRANSLATION_KEYS } from "@repo/auth-flow";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";

/**
 * `@repo/auth-flow` ships no copy of its own — studio owns every string the
 * sign-in dialog renders, in all three locales. A key the package adds later is
 * a compile error at the call site but would be a raw `auth.foo` on screen in a
 * locale nobody re-checked, so assert coverage here instead.
 */
const CATALOGS = {
  "en-US": enUS.auth,
  "zh-CN": zhCN.auth,
  "zh-HK": zhHK.auth,
} as const satisfies Record<string, Record<string, string>>;

/** `{account}` / `{seconds}` / `{index}` — same delimiters in both i18n stacks. */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe.each(Object.entries(CATALOGS))("auth messages — %s", (_locale, catalog) => {
  const messages: Record<string, string> = catalog;

  it.each(AUTH_TRANSLATION_KEYS)("translates %s", (key) => {
    expect(messages[key]?.trim()).toBeTruthy();
  });

  it("interpolates exactly the variables en-US does", () => {
    for (const key of AUTH_TRANSLATION_KEYS) {
      expect(placeholders(messages[key] ?? ""), key).toEqual(placeholders(enUS.auth[key]));
    }
  });
});
