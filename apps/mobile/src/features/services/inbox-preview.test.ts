import { expect, it } from "vitest";
import { SYSTEM_MESSAGE_KINDS } from "@repo/shared/conversation";
import en from "@/i18n/messages/en-US.json";
import cn from "@/i18n/messages/zh-CN.json";
import hk from "@/i18n/messages/zh-HK.json";
import { inboxPreview } from "./inbox-preview";
const catalogs = { "en-US": en, "zh-CN": cn, "zh-HK": hk };
const translate = (locale: keyof typeof catalogs, key: keyof typeof en) => catalogs[locale][key];

it.each(["en-US", "zh-CN", "zh-HK"] as const)(
  "localizes every supported activity in %s",
  (locale) => {
    for (const kind of SYSTEM_MESSAGE_KINDS) {
      const result = inboxPreview(
        { lastMessageType: "system", lastMessagePreview: `[system:${kind}]` },
        (key) => translate(locale, key)
      );
      expect(result).not.toContain("inbox.");
      expect(result).not.toContain("[system:");
      expect(result).not.toBe(translate(locale, "inbox.preview.system"));
    }
  }
);

it("preserves literal text markers and safely handles malformed or future activity", () => {
  const t = (key: Parameters<typeof translate>[1]) => translate("en-US", key);
  expect(
    inboxPreview({ lastMessageType: "text", lastMessagePreview: "[system:order.completed]" }, t)
  ).toBe("[system:order.completed]");
  for (const raw of [
    "[system]",
    "[system:future.event]",
    "[system:order.completed",
    "arbitrary payload",
  ]) {
    expect(inboxPreview({ lastMessageType: "system", lastMessagePreview: raw }, t)).toBe(
      "Conversation activity"
    );
  }
  expect(inboxPreview({ lastMessageType: "text", lastMessagePreview: "" }, t)).toBe(
    "(no messages yet)"
  );
  expect(inboxPreview({ lastMessageType: "file", lastMessagePreview: "private data" }, t)).toBe(
    "File"
  );
});

it("formats recent and earlier message times in the active locale", async () => {
  const { inboxTime } = await import("./inbox-preview");
  const date = new Date(2026, 9, 2, 14, 5);
  expect(inboxTime(date.toISOString(), "en-US", date)).toBe(
    date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
  );
  expect(inboxTime(date.toISOString(), "zh-CN", new Date(2026, 9, 3))).toBe(
    date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" })
  );
  expect(inboxTime("invalid", "en-US", date)).toBe("invalid");
});
