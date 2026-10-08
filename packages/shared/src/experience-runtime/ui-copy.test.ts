import { expect, it } from "vitest";
import {
  ExperienceUIPresentationSchema,
  mergeExperienceUIPresentation,
  resolveExperienceStartLabel,
} from "./ui";

it("keeps start copy scoped to its locale, supports default restoration and retains the theme", () => {
  const current = ExperienceUIPresentationSchema.parse({
    copy: { start: { "en-US": "Enter story", "zh-CN": "Begin" } },
    theme: {
      version: 1,
      name: "Palace",
      css: '[data-experience-ui-region="start"] [data-ui-part="primary"]{color:#d6b77a}',
      assets: [],
    },
  });
  const updated = mergeExperienceUIPresentation(
    current,
    ExperienceUIPresentationSchema.parse({ copy: { start: { "zh-CN": null, "zh-HK": "Enter" } } })
  );
  expect(updated.theme).toBe(current.theme);
  expect(resolveExperienceStartLabel(updated.copy, "en-US", "Start")).toBe("Enter story");
  expect(resolveExperienceStartLabel(updated.copy, "zh-CN", "Start")).toBe("Start");
  expect(resolveExperienceStartLabel(updated.copy, "zh-HK", "Start")).toBe("Enter");
  expect(resolveExperienceStartLabel(updated.copy, "fr-FR", "Start")).toBe("Start");
  expect(resolveExperienceStartLabel(updated.copy, "toString", "Start")).toBe("Start");
  expect(mergeExperienceUIPresentation(updated, { theme: current.theme }).copy).toEqual(
    updated.copy
  );
});

it.each([
  {},
  { "en-US": "" },
  { "en-US": "   " },
  { "en-US": "x".repeat(81) },
  { "en-US": "Begin\nnow" },
  { "fr-FR": "Start" },
])("rejects invalid labels without accepting a blank or unknown locale: %j", (start) => {
  expect(ExperienceUIPresentationSchema.safeParse({ copy: { start } }).success).toBe(false);
});
