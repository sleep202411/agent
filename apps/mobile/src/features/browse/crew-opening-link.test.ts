import { expect, it } from "vitest";
import { redirectCrewOpening } from "./crew-opening-link";
it.each([
  "/crews/crew/positions/job",
  "/zh-CN/crews/crew/positions/job/",
  "https://fizzdragon.com/en-US/crews/crew/positions/job",
  "fizzdragon-dev://crews/crew/positions/job",
])("preserves exact selected job: %s", (path) => {
  expect(redirectCrewOpening(path, "global", ["fizzdragon-dev"])).toBe(
    "/crew-opening?crewId=crew&positionId=job"
  );
});
it("maps China links only in China", () => {
  const path = "https://fizzdragon.fizzspace.cn/zh-HK/crews/c/positions/p";
  expect(redirectCrewOpening(path, "cn", [])).toBe("/crew-opening?crewId=c&positionId=p");
  expect(redirectCrewOpening(path, "global", [])).toBe(path);
});
it.each([
  "https://evil.test/crews/c/positions/p",
  "https://u@fizzdragon.com/crews/c/positions/p",
  "https://fizzdragon.com:444/crews/c/positions/p",
  "/crews/c/positions/p?token=secret",
  "/crews/c/positions/%2f",
  "/crews/c/positions/p#fragment",
  "/crews/c/positions/p\\x",
  "wxpay://callback?code=a",
  "/casting-invite?link=x",
])("leaves unsupported or unrelated paths intact: %s", (path) =>
  expect(redirectCrewOpening(path, "global", [])).toBe(path)
);
