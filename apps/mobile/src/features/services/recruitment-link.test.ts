import { expect, it } from "vitest";
import { redirectRecruitment } from "./recruitment-link";
it.each([
  "/messages?tab=recruitment&application=app_1",
  "/zh-CN/messages?application=app_1&tab=recruitment",
  "https://fizzdragon.com/en-US/messages?tab=recruitment&application=app_1",
  "fizzdragon://messages?tab=recruitment&application=app_1",
])("preserves exact application selections %s", (path) => {
  expect(redirectRecruitment(path, "global", ["fizzdragon"])).toBe(
    "/crew-applications?application=app_1"
  );
});
it("maps unselected recruitment and matching regional hosts", () => {
  expect(redirectRecruitment("/messages?tab=recruitment", "global", [])).toBe("/crew-applications");
  expect(
    redirectRecruitment(
      "https://fizzdragon.fizzspace.cn/messages?tab=recruitment&application=a",
      "cn",
      []
    )
  ).toBe("/crew-applications?application=a");
});
it.each([
  "https://evil.test/messages?tab=recruitment&application=a",
  "https://fizzdragon.fizzspace.cn/messages?tab=recruitment&application=a",
  "//fizzdragon.com/messages?tab=recruitment",
  "/messages?tab=recruitment&application=../bad",
  "/messages?tab=recruitment&application=a&application=b",
  "/messages?tab=recruitment&tab=chat",
  "/messages?tab=recruitment&token=secret",
  "/messages?tab=recruitment#callback",
  "/messages?tab=chat&application=a",
])("preserves unsupported or ambiguous callbacks %s", (path) => {
  expect(redirectRecruitment(path, "global", [])).toBe(path);
});
