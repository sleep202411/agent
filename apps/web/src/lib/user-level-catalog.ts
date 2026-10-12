/**
 * FizzDragon Passport verification catalogue.
 *
 * Read-only overlay on existing Java `/user/levels/options` rows.
 * Does not insert or update MySQL `user_level`.
 *
 * Java `user_level.type`:
 *   1 = AI Director Verification
 *   2 = account privilege (e.g. free IP watch, id 12) — not applyable
 *   3 = honor / non-skill privilege — not applyable
 *   4 = Skill Verification
 *   5 = Partner Verification
 */

export const USER_LEVEL_TYPE = {
  AI_DIRECTOR: 1,
  PRIVILEGE: 2,
  HONOR: 3,
  SKILL: 4,
  PARTNER: 5,
} as const;

export type VerificationGroup = "partner" | "aiDirector" | "skill";

export type UserLevelCatalogSlug =
  | "cityPartner"
  | "distributor"
  | "instructor"
  | "opcFounder"
  | "affiliateCreator"
  | "juniorCreator"
  | "seniorCreator"
  | "masterCreator"
  | "distinguishedCreator"
  | "aiProducer"
  | "artDirector"
  | "director"
  | "editor"
  | "musicComposer"
  | "scriptwriter";

export type UserLevelCatalogItem = {
  slug: UserLevelCatalogSlug;
  group: VerificationGroup;
  /** Known production ids. Matching still falls back to aliases. */
  ids: readonly number[];
  aliases: readonly string[];
};

export const VERIFICATION_GROUP_ORDER: readonly VerificationGroup[] = [
  "partner",
  "aiDirector",
  "skill",
];

export const USER_LEVEL_CATALOG: readonly UserLevelCatalogItem[] = [
  {
    slug: "cityPartner",
    group: "partner",
    ids: [5],
    aliases: [
      "city partner",
      "citypartner",
      "城市合伙人",
      "城市合夥人",
      "城市合作伙伴",
      "城市合作夥伴",
    ],
  },
  {
    slug: "distributor",
    group: "partner",
    ids: [],
    aliases: [
      "distributor",
      "分销商",
      "分銷商",
      "发行人",
      "發行人",
      "全球认证发行人",
      "全球認證發行人",
    ],
  },
  {
    slug: "instructor",
    group: "partner",
    ids: [18],
    aliases: ["instructor", "讲师", "講師", "认证讲师", "認證講師"],
  },
  {
    slug: "opcFounder",
    group: "partner",
    ids: [4],
    aliases: ["opc founder", "opcfounder", "opc", "opc创始人", "opc創始人", "opc 创始人"],
  },
  {
    slug: "affiliateCreator",
    group: "aiDirector",
    ids: [1],
    aliases: [
      "fd-1 affiliate creator gacha artist",
      "fd 1 affiliate creator gacha artist",
      "fd-1·affiliate creator - gacha artist",
      "fd-i affiliate creator",
      "fd i affiliate creator",
      "fd-1 affiliate creator",
      "fd 1 affiliate creator",
      "fd-i · affiliate creator",
      "affiliate creator",
      "affiiate creator",
      "gacha artist",
      "fd-i",
      "fd1",
      "fd-1",
      "fd i",
      "fd 1",
      "fd-1 附属创作者 抽卡师",
      "fd 1 附属创作者 抽卡师",
      "fd-i · 附属创作者",
      "fd i 附属创作者",
      "附属创作者",
      "附屬創作者",
      "入门创作者",
      "入門創作者",
      "fd i 入门创作者 抽卡师",
      "fd-i · 入门创作者-抽卡师",
      "抽卡师",
      "抽卡師",
    ],
  },
  {
    slug: "juniorCreator",
    group: "aiDirector",
    ids: [2],
    aliases: [
      "fd-ii junior creator rough cut",
      "fd ii junior creator rough cut",
      "fd-ii·junior creator - rough cut",
      "fd-ii junior creator",
      "fd ii junior creator",
      "fd-2 junior creator",
      "fd 2 junior creator",
      "fd-1i junior creator",
      "fd-1i.juniorcreator",
      "fd 1i juniorcreator",
      "junior creator",
      "rough cut",
      "fd-ii",
      "fd2",
      "fd-2",
      "fd ii",
      "fd 2",
      "fd-ii 初级创作者 粗剪",
      "fd ii 初级创作者 粗剪",
      "fd-ii 初级创作者",
      "fd ii 初级创作者",
      "fd-ii · 初级创作者",
      "初级创作者",
      "初級創作者",
    ],
  },
  {
    slug: "seniorCreator",
    group: "aiDirector",
    ids: [3],
    aliases: [
      "fd-senior creator ai short drama",
      "fd senior creator ai short drama",
      "fd-seniorcreator",
      "fd seniorcreator",
      "fd-iii senior creator",
      "fd iii senior creator",
      "fd-3 senior creator",
      "fd 3 senior creator",
      "fd-senior creator",
      "fd senior creator",
      "senior creator",
      "ai short drama",
      "fd-iii",
      "fd3",
      "fd-3",
      "fd iii",
      "fd 3",
      "fd 高级创作者 ai短剧",
      "fd 高級創作者 ai短劇",
      "fd-iii 高级创作者",
      "fd iii 高级创作者",
      "fd-iii · 高级创作者",
      "fd iii 高级创作者 ai短剧",
      "fd-iii · 高级创作者-ai短剧",
      "高级创作者",
      "高級創作者",
    ],
  },
  {
    slug: "masterCreator",
    group: "aiDirector",
    ids: [7],
    aliases: [
      "fd-iv master creator ai web film",
      "fd iv master creator ai web film",
      "fd-iv·master creator - ai web film",
      "fd-iv master creator",
      "fd iv master creator",
      "fd-4 master creator",
      "fd 4 master creator",
      "fd-ivmastercreator",
      "master creator",
      "ai web film",
      "fd-iv",
      "fd4",
      "fd-4",
      "fd iv",
      "fd 4",
      "fd-iv 大师创作者 ai网络电影",
      "fd iv 大师创作者 ai网络电影",
      "fd-iv 大师创作者",
      "fd iv 大师创作者",
      "fd-iv · 大师创作者",
      "大师创作者",
      "大師創作者",
    ],
  },
  {
    slug: "distinguishedCreator",
    group: "aiDirector",
    ids: [8],
    aliases: [
      "fd-v distinguished creator ai theatrical film",
      "fd v distinguished creator ai theatrical film",
      "fd-v·distinguished creator - ai theatrical film",
      "fd-v distinguished creator",
      "fd v distinguished creator",
      "fd-5 distinguished creator",
      "fd 5 distinguished creator",
      "distinguished creator",
      "ai theatrical film",
      "fd-v",
      "fd5",
      "fd-5",
      "fd v",
      "fd 5",
      "fd-v 杰出创作者 ai院线电影",
      "fd v 杰出创作者 ai院线电影",
      "fd-v 杰出创作者",
      "fd v 杰出创作者",
      "fd-v · 杰出创作者",
      "杰出创作者",
      "傑出創作者",
    ],
  },
  {
    slug: "aiProducer",
    group: "skill",
    ids: [13],
    aliases: ["ai producer", "ai制片人", "ai製片人", "制片人", "製片人"],
  },
  {
    slug: "artDirector",
    group: "skill",
    ids: [14],
    aliases: ["art director", "艺术总监", "藝術總監", "美术导演", "美術導演"],
  },
  {
    slug: "director",
    group: "skill",
    ids: [15],
    aliases: ["director", "导演", "導演"],
  },
  {
    slug: "editor",
    group: "skill",
    ids: [16],
    aliases: ["editor", "editing", "剪辑师", "剪輯師"],
  },
  {
    slug: "musicComposer",
    group: "skill",
    ids: [17],
    aliases: ["music composer", "music", "音乐作曲", "音樂作曲", "配乐师", "配樂師"],
  },
  {
    slug: "scriptwriter",
    group: "skill",
    ids: [19],
    aliases: ["scriptwriter", "scriptwritter", "编剧", "編劇"],
  },
];

const PRIVILEGE_LEVEL_IDS = new Set([12]);

const ALIAS_INDEX = new Map<string, UserLevelCatalogItem>();
for (const item of USER_LEVEL_CATALOG) {
  for (const alias of item.aliases) {
    ALIAS_INDEX.set(normalizeLevelName(alias), item);
  }
}

const ID_INDEX = new Map<number, UserLevelCatalogItem>();
for (const item of USER_LEVEL_CATALOG) {
  for (const id of item.ids) ID_INDEX.set(id, item);
}

export function normalizeLevelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[·•._/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchUserLevelCatalog(level: {
  id?: number | null;
  name?: string | null;
}): UserLevelCatalogItem | null {
  const id = Number(level.id);
  if (Number.isSafeInteger(id) && id > 0) {
    const byId = ID_INDEX.get(id);
    if (byId) return byId;
  }
  const name = typeof level.name === "string" ? normalizeLevelName(level.name) : "";
  if (!name) return null;
  return ALIAS_INDEX.get(name) ?? null;
}

export function isApplyableUserLevel(level: {
  id?: number | null;
  type?: number | null;
  name?: string | null;
}): boolean {
  const id = Number(level.id);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const type = level.type == null ? null : Number(level.type);
  if (type === USER_LEVEL_TYPE.PRIVILEGE || type === USER_LEVEL_TYPE.HONOR) return false;
  // Historical free-watch row reused id 12. Hide it unless the live name is a
  // catalogue certification (currently 分销商 / Distributor).
  if (PRIVILEGE_LEVEL_IDS.has(id)) {
    return matchUserLevelCatalog({ name: level.name }) != null;
  }
  return true;
}

export function verificationGroupForLevel(level: {
  id?: number | null;
  name?: string | null;
  type?: number | null;
}): VerificationGroup | "other" {
  const type = level.type == null ? null : Number(level.type);
  if (type === USER_LEVEL_TYPE.PARTNER) return "partner";
  if (type === USER_LEVEL_TYPE.AI_DIRECTOR) return "aiDirector";
  if (type === USER_LEVEL_TYPE.SKILL) return "skill";
  return matchUserLevelCatalog(level)?.group ?? "other";
}

export type GroupedUserLevel<T> = {
  group: VerificationGroup | "other";
  levels: T[];
};

function preferCatalogOption<T extends { id: number; name: string }>(
  item: UserLevelCatalogItem,
  current: T,
  next: T
): T {
  if (item.ids.includes(current.id) && !item.ids.includes(next.id)) return current;
  if (item.ids.includes(next.id) && !item.ids.includes(current.id)) return next;
  return current.id <= next.id ? current : next;
}

export function groupUserLevelOptions<T extends { id: number; name: string; type?: number | null }>(
  options: readonly T[]
): GroupedUserLevel<T>[] {
  const buckets = new Map<VerificationGroup, T[]>();
  for (const key of VERIFICATION_GROUP_ORDER) buckets.set(key, []);

  const catalogIndex = new Map(USER_LEVEL_CATALOG.map((item, index) => [item.slug, index]));
  const bySlug = new Map<string, { item: UserLevelCatalogItem; level: T }>();

  for (const level of options.filter(isApplyableUserLevel)) {
    const item = matchUserLevelCatalog(level);
    if (!item) continue;
    const previous = bySlug.get(item.slug);
    bySlug.set(item.slug, {
      item,
      level: previous ? preferCatalogOption(item, previous.level, level) : level,
    });
  }

  const unique = [...bySlug.values()].sort(
    (a, b) => (catalogIndex.get(a.item.slug) ?? 999) - (catalogIndex.get(b.item.slug) ?? 999)
  );
  for (const row of unique) {
    buckets.get(row.item.group)?.push(row.level);
  }

  return [...buckets.entries()]
    .filter(([, levels]) => levels.length > 0)
    .map(([group, levels]) => ({ group, levels }));
}

export function userLevelDisplayCopy(
  level: { id?: number | null; name: string; description?: string | null },
  t: (key: string) => string
): { name: string; description: string } {
  const javaName = level.name.trim();
  const javaDescription = (level.description ?? "").trim();
  const item = matchUserLevelCatalog(level);
  if (!item) {
    return { name: javaName, description: javaDescription };
  }
  return {
    name: javaName,
    description: javaDescription || t(`levels.items.${item.slug}.description`),
  };
}
