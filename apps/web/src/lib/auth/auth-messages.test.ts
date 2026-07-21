import { describe, expect, it } from "vitest";
import { AUTH_TRANSLATION_KEYS } from "@repo/auth-flow";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";

/**
 * `@repo/auth-flow` ships no copy of its own — this app owns every string
 * the sign-in dialog renders, in all three locales.
 *
 * `auth-dialog-provider.tsx` asserts en-US coverage at COMPILE time, which
 * is all a `Record<AuthTranslationKey, string>` can see: zh-CN and zh-HK
 * are never type-checked against the key union, so a key added to the
 * package (or a locale file edited without its siblings) silently degrades
 * a Chinese user to English — or, when i18next has no fallback for that
 * subtree, to the raw `auth.foo`. Assert all three here, the same way
 * `apps/studio/lib/auth-messages.test.ts` does.
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
