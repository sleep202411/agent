import { expect, it } from "vitest";
import { localizeVisible } from "./localize";

it.each([
  ["missing", undefined],
  ["empty", {}],
  ["blank", { "en-US": "  " }],
  ["zero-width placeholder", { "en-US": "\u200B" }],
  ["word joiner", { "en-US": " \u2060 " }],
])("treats a %s prompt as absent", (_, value) => {
  expect(localizeVisible(value, "en-US", "en-US")).toBe("");
});

it("keeps visible text, trimmed, with locale fallback", () => {
  expect(localizeVisible({ "en-US": " Which way? " }, "en-US", "en-US")).toBe("Which way?");
  expect(localizeVisible({ "en-US": "Which way?" }, "zh-CN", "en-US")).toBe("Which way?");
  expect(localizeVisible({ "en-US": "\u200BWhich way?" }, "en-US", "en-US")).toBe(
    "\u200BWhich way?"
  );
});
