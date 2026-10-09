import { describe, expect, it } from "vitest";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
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

const STUDIO_CATALOGS = { "en-US": enUS, "zh-CN": zhCN, "zh-HK": zhHK } as const;

function messageLeaves(messages: AbstractIntlMessages, prefix = ""): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value]] : messageLeaves(value, path);
  });
}

it.each(Object.entries(STUDIO_CATALOGS))(
  "%s resolves FizzAgent copy from its root namespace and keeps player copy separate",
  (locale, catalog) => {
    // A missing closing brace previously moved the whole Agent catalog into
    // experiencePlayer while leaving valid JSON and matching locale key sets.
    const messages: AbstractIntlMessages = catalog;
    const onError = (error: Error) => {
      throw error;
    };
    const agent = createTranslator({ locale, messages, namespace: "agentOs", onError });
    const player = createTranslator({ locale, messages, namespace: "experiencePlayer", onError });
    const referenceKeys = messageLeaves(enUS.agentOs).map(([key]) => key);
    const translatedLeaves = messageLeaves(catalog.agentOs);

    expect(translatedLeaves.map(([key]) => key).sort()).toEqual(referenceKeys.sort());
    for (const [key, message] of translatedLeaves) {
      expect(agent.raw(key), key).toBe(message);
    }
    for (const key of [
      "readOnlyProject",
      "title",
      "subtitle",
      "close",
      "collapse",
      "open",
      "launcherPrompts.create",
      "launcherPrompts.ask",
      "launcherPrompts.help",
      "runDetails.open",
      "runDetails.title",
      "runDetails.description",
      "runDetails.status",
      "runDetails.statusValue.idle",
      "runDetails.conversationId",
      "runDetails.notAvailable",
      "runDetails.latestIssue",
      "runDetails.technicalDetail",
      "runDetails.close",
    ]) {
      expect(agent(key), key).toBe(agent.raw(key));
    }
    for (const key of ["start", "journeyMap.title", "world.finish", "playback.pause"]) {
      expect(player(key), key).toBe(player.raw(key));
    }
    expect(player.has("runDetails.title")).toBe(false);
    expect(player.has("modelSettings.title")).toBe(false);
  }
);
