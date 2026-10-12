import { expect, it } from "vitest";
import {
  groupUserLevelOptions,
  isApplyableUserLevel,
  matchUserLevelCatalog,
  userLevelDisplayCopy,
  verificationGroupForLevel,
} from "./user-level-catalog";

it("matches known ids and current Java names", () => {
  expect(matchUserLevelCatalog({ id: 1, name: "FD-I · 附属创作者" })?.slug).toBe(
    "affiliateCreator"
  );
  expect(matchUserLevelCatalog({ id: 13, name: "AI制片人" })?.slug).toBe("aiProducer");
  expect(matchUserLevelCatalog({ name: "FD-1I.JuniorCreator" })?.slug).toBe("juniorCreator");
  expect(matchUserLevelCatalog({ name: "FD-1·Affiliate Creator - Gacha Artist" })?.slug).toBe(
    "affiliateCreator"
  );
  expect(matchUserLevelCatalog({ name: "FD-1·附属创作者-抽卡师" })?.slug).toBe("affiliateCreator");
  expect(matchUserLevelCatalog({ name: "FD-I·入门创作者-抽卡师" })?.slug).toBe("affiliateCreator");
  expect(matchUserLevelCatalog({ name: "FD-Senior Creator - AI Short Drama" })?.slug).toBe(
    "seniorCreator"
  );
  expect(matchUserLevelCatalog({ id: 3, name: "FD-III·高级创作者-AI短剧" })?.slug).toBe(
    "seniorCreator"
  );
  expect(matchUserLevelCatalog({ name: "FD-III·高级创作者-AI短剧" })?.slug).toBe("seniorCreator");
  expect(matchUserLevelCatalog({ name: "分销商" })?.slug).toBe("distributor");
  expect(matchUserLevelCatalog({ name: "城市合伙人" })?.slug).toBe("cityPartner");
  expect(matchUserLevelCatalog({ name: "OPC创始人" })?.slug).toBe("opcFounder");
  expect(matchUserLevelCatalog({ name: "OPC Founder" })?.slug).toBe("opcFounder");
  expect(matchUserLevelCatalog({ name: "艺术总监" })?.slug).toBe("artDirector");
  expect(matchUserLevelCatalog({ name: "音乐作曲" })?.slug).toBe("musicComposer");
  expect(matchUserLevelCatalog({ name: "Scriptwritter" })?.slug).toBe("scriptwriter");
  expect(matchUserLevelCatalog({ name: "Art Director" })?.slug).toBe("artDirector");
  expect(matchUserLevelCatalog({ name: "Director" })?.slug).toBe("director");
});

it("does not treat FD-II as FD-I", () => {
  expect(matchUserLevelCatalog({ name: "FD-II" })?.slug).toBe("juniorCreator");
  expect(matchUserLevelCatalog({ name: "FD-I" })?.slug).toBe("affiliateCreator");
});

it("hides privilege / honor rows from the apply catalogue", () => {
  expect(isApplyableUserLevel({ id: 12, type: 2, name: "Free viewing" })).toBe(false);
  expect(isApplyableUserLevel({ id: 20, type: 3 })).toBe(false);
  expect(isApplyableUserLevel({ id: 13, type: 4 })).toBe(true);
  expect(isApplyableUserLevel({ id: 1, type: 1 })).toBe(true);
  expect(isApplyableUserLevel({ id: 12, type: 4, name: "分销商" })).toBe(true);
});

it("groups Java options by type, then by catalogue aliases", () => {
  const grouped = groupUserLevelOptions([
    { id: 13, name: "AI制片人", type: 4 },
    { id: 1, name: "FD-I · 附属创作者", type: 1 },
    { id: 12, name: "Free viewing", type: 2 },
    { id: 30, name: "City Partner", type: 4 },
    { id: 32, name: "OPC创始人", type: 4 },
    { id: 31, name: "Editor" },
  ]);
  expect(grouped.map((row) => row.group)).toEqual(["partner", "aiDirector", "skill"]);
  expect(grouped[0]?.levels.map((row) => row.id)).toEqual([30, 32]);
  expect(grouped[1]?.levels.map((row) => row.id)).toEqual([1]);
  expect(grouped[2]?.levels.map((row) => row.id)).toEqual([13, 31]);
});

it("keeps one option per catalogue slug and hides leftover Java rows", () => {
  const grouped = groupUserLevelOptions([
    { id: 2, name: "FD-II · 初级创作者", type: 1 },
    { id: 41, name: "FD-II·初级创作者-粗剪", type: 1 },
    { id: 7, name: "FD-IV · 大师创作者", type: 1 },
    { id: 44, name: "FD-IV·大师创作者-AI网络电影", type: 1 },
    { id: 13, name: "AI制片人", type: 4 },
    { id: 50, name: "音乐作曲", type: 4 },
    { id: 51, name: "Music Composer", type: 4 },
    { id: 60, name: "美术指导", type: 4 },
    { id: 61, name: "AI讲师", type: 4 },
  ]);
  expect(grouped.map((row) => row.group)).toEqual(["aiDirector", "skill"]);
  expect(grouped[0]?.levels.map((row) => row.name)).toEqual([
    "FD-II · 初级创作者",
    "FD-IV · 大师创作者",
  ]);
  expect(grouped[1]?.levels.map((row) => row.id)).toEqual([13, 50]);
});

it("keeps live MySQL certification rows, including 分销商 on id 12 and FD-III", () => {
  const grouped = groupUserLevelOptions([
    { id: 1, name: "FD-I·入门创作者-抽卡师", type: 1 },
    { id: 2, name: "FD-II·初级创作者-粗剪", type: 1 },
    { id: 3, name: "FD-III·高级创作者-AI短剧", type: 1 },
    { id: 4, name: "OPC创始人", type: 4 },
    { id: 5, name: "城市合伙人", type: 4 },
    { id: 7, name: "FD-IV·大师创作者-AI网络电影", type: 1 },
    { id: 8, name: "FD-V·杰出创作者-AI院线电影", type: 1 },
    { id: 12, name: "分销商", type: 4 },
    { id: 13, name: "AI制片人", type: 4 },
    { id: 14, name: "艺术总监", type: 4 },
    { id: 15, name: "导演", type: 4 },
    { id: 16, name: "剪辑师", type: 4 },
    { id: 17, name: "音乐作曲", type: 4 },
    { id: 18, name: "讲师", type: 4 },
    { id: 19, name: "编剧", type: 4 },
  ]);
  expect(grouped.map((row) => row.group)).toEqual(["partner", "aiDirector", "skill"]);
  expect(grouped[0]?.levels.map((row) => row.id)).toEqual([5, 12, 18, 4]);
  expect(grouped[1]?.levels.map((row) => row.id)).toEqual([1, 2, 3, 7, 8]);
  expect(grouped[2]?.levels.map((row) => row.id)).toEqual([13, 14, 15, 16, 17, 19]);
});

it("prefers Java type over a mismatched name", () => {
  expect(verificationGroupForLevel({ id: 99, name: "City Partner", type: 1 })).toBe("aiDirector");
});

it("keeps Java names and fills empty descriptions from the catalogue", () => {
  expect(
    userLevelDisplayCopy(
      { id: 3, name: "FD-III·高级创作者-AI短剧", description: "核心能力" },
      (key) => key
    )
  ).toEqual({
    name: "FD-III·高级创作者-AI短剧",
    description: "核心能力",
  });
  expect(
    userLevelDisplayCopy(
      { id: 3, name: "FD-III·高级创作者-AI短剧", description: null },
      (key) => key
    )
  ).toEqual({
    name: "FD-III·高级创作者-AI短剧",
    description: "levels.items.seniorCreator.description",
  });
  expect(
    userLevelDisplayCopy({ id: 99, name: "Honor", description: "kept" }, (key) => key)
  ).toEqual({
    name: "Honor",
    description: "kept",
  });
});
