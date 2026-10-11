import { expect, it } from "vitest";
import {
  emptyStudioDraft,
  parseStudioDraft,
  readStudioLink,
  redirectStudioSearch,
  studioDraftFromQuery,
  studioLinkParams,
} from "./studio-search-link";
it("reads the official filter names, normalizes cities, and preserves selected studios", () => {
  const link = readStudioLink({
    text: " Film ",
    category: "animation",
    basedCountry: "sg",
    basedCity: " Singapore ",
    servesCountry: "MY",
    servesCity: "Johor Bahru",
    remote: "1",
    available: "1",
    selected: "studio",
  });
  expect(link.invalid).toBe(false);
  expect(link.selected).toBe("studio");
  const parsed = parseStudioDraft(link.draft);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw Error("Expected valid query");
  expect(parsed.data).toEqual({
    text: "Film",
    category: "animation",
    basedIn: { countryCode: "SG", city: "Singapore" },
    serves: { countryCode: "MY", city: "Johor Bahru" },
    remoteOnly: true,
    availableForWork: true,
  });
  expect(parseStudioDraft(studioDraftFromQuery(parsed.data))).toEqual(parsed);
  expect(studioLinkParams(parsed.data, "studio").selected).toBe("studio");
  expect(studioLinkParams(parsed.data).selected).toBe("");
});
it("does not silently relax malformed flags, categories, cities or repeated parameters", () => {
  for (const bad of [
    { remote: "false" },
    { available: "true" },
    { category: "not-a-category" },
    { basedCity: "Singapore" },
    { servesCountry: "MY" },
    { text: "a".repeat(121) },
  ])
    expect(parseStudioDraft({ ...emptyStudioDraft, ...bad }).success).toBe(false);
  for (const bad of [
    { remote: ["1", ""] },
    { selected: ["a", "b"] },
    { text: ["a"] },
    { selected: "a".repeat(65) },
  ])
    expect(readStudioLink(bad).invalid).toBe(true);
  expect(readStudioLink({ utm_source: "newsletter" }).invalid).toBe(false);
  expect(parseStudioDraft(emptyStudioDraft).success).toBe(true);
});
it("normalizes regional/localized/app studio links while preserving their exact query", () => {
  const query = "?basedCountry=SG&basedCity=Singapore&remote=1&selected=a%2Fb&text=Film+work";
  for (const base of [
    "/creators/studios",
    "/zh-CN/creators/studios/",
    "/studios",
    "https://fizzdragon.com/en-US/creators/studios",
    "fizzdragon-dev://creators/studios",
    "fizzdragon-dev:///studios",
  ])
    expect(redirectStudioSearch(base + query, "global", ["fizzdragon-dev"])).toBe(
      "/studios" + query
    );
  expect(
    redirectStudioSearch(
      "https://fizzdragon.fizzspace.cn/zh-HK/creators/studios?remote=1",
      "cn",
      []
    )
  ).toBe("/studios?remote=1");
  expect(redirectStudioSearch("/creators/studios?remote=0&remote=1", "global", [])).toBe(
    "/studios?remote=0&remote=1"
  );
});
it("leaves foreign sites, credentials, fragments and unrelated callbacks untouched", () => {
  for (const path of [
    "https://fizzdragon.fizzspace.cn/creators/studios",
    "https://evil.test/creators/studios",
    "http://fizzdragon.com/creators/studios",
    "https://user@fizzdragon.com/creators/studios",
    "https://fizzdragon.com:444/creators/studios",
    "//evil.test/creators/studios",
    "/creators/studios#section",
    "wxpay://callback?code=a",
    "fizzdragon://creators/studios",
    "/agent?workspace=a",
    "/creators/studios/other",
    "/creators/\\studios",
    "/creators/%ZZ",
  ])
    expect(redirectStudioSearch(path, "global", ["fizzdragon-dev"])).toBe(path);
});

it("retains explicit island discovery while leaving the default search unfiltered", () => {
  const parsed = parseStudioDraft(readStudioLink({ location: "island" }).draft);
  expect(parsed).toMatchObject({ success: true, data: { islandOnly: true } });
  if (!parsed.success) throw Error("Invalid fixture");
  expect(studioLinkParams(parsed.data).location).toBe("island");
  expect(parseStudioDraft(emptyStudioDraft)).toMatchObject({ success: true });
  expect(parseStudioDraft({ ...emptyStudioDraft, location: "unknown" }).success).toBe(false);
  expect(readStudioLink({ location: ["island", ""] }).invalid).toBe(true);
});
