export type InteractiveFilmAssetKind = "video" | "audio";
export type InteractiveFilmAssetRole =
  | "prologue"
  | "chapter"
  | "main"
  | "reaction"
  | "ending"
  | "audio";

export type InteractiveFilmAsset = {
  assetId: string;
  label: string;
  kind: InteractiveFilmAssetKind;
  role: InteractiveFilmAssetRole;
  url: string;
  durationSeconds?: number;
};

export type InteractiveFilmChoice = {
  choiceId: string;
  label: string;
  reactionAssetId: string;
  targetSceneId?: string;
  endingId?: string;
};

export type InteractiveFilmScene = {
  sceneId: string;
  number: number;
  eyebrow: string;
  title: string;
  summary: string;
  masterAssetId: string;
  sequenceAssetIds: string[];
  choices: InteractiveFilmChoice[];
};

export type InteractiveFilmEnding = {
  endingId: string;
  title: string;
  assetId: string;
  fallback?: boolean;
};

export type InteractiveFilmCreatorDraft = {
  schemaVersion: "story-studio-interactive-film-v1";
  projectId: string;
  mode: "interactive-film";
  title: string;
  subtitle: string;
  orientation: "landscape-only";
  entrySceneId: string;
  scenes: InteractiveFilmScene[];
  endings: InteractiveFilmEnding[];
};

const RELEASE_ROOT =
  "https://fizzdragonblob.blob.core.windows.net/foundry-outputs/interactive-films/jinling-rumeng/s01/v1";

const video = (
  relativePath: string,
  role: InteractiveFilmAssetRole,
  durationSeconds = 15
): InteractiveFilmAsset => ({
  assetId: relativePath.replace(/\.mp4$/, "").replaceAll("/", ":"),
  label:
    relativePath
      .split("/")
      .at(-1)
      ?.replace(/\.mp4$/, "") ?? relativePath,
  kind: "video",
  role,
  url: `${RELEASE_ROOT}/${relativePath}`,
  durationSeconds,
});

const audio = (fileName: string): InteractiveFilmAsset => ({
  assetId: `audio:${fileName.replace(/\.wav$/, "")}`,
  label: fileName.replace(/\.wav$/, ""),
  kind: "audio",
  role: "audio",
  url: `${RELEASE_ROOT}/audio/${fileName}`,
});

const mainIds = [
  "a1-s01-carriage-wake",
  "a1-s02-daiyu-sedan",
  "a1-s03-gate-arrival",
  "a1-s04-gate-question",
  "a2-s01-corridor-entry",
  "a2-s02-wind-crisis",
  "a2-s03-jiamu-embrace",
  "a2-s04-jiamu-comfort",
  "a2-s05-jiamu-turns",
  "a2-s06-letter-to-xifeng",
  "a3-s01-xifeng-closes-door",
  "a3-s02-xifeng-date-trap",
  "a3-s03-xifeng-seal",
  "a3-s04-baoyu-formal-entry",
  "a3-s05-baoyu-home-return",
  "a3-s06-baoyu-recognition",
  "a3-s07-ask-about-jade",
  "a3-s08-jade-throw",
  "a4-s01-daiyu-night-arrival",
  "a4-s02-daiyu-remembers",
  "a4-s03-letter-reveal",
  "a4-s04-daiyu-refuses-fate",
  "a4-s05-seal-awakens",
  "a4-s06-letter-choice-wait",
] as const;

const reactionIds = [
  "c1-r01-old-trust",
  "c1-r02-daiyu-road",
  "c1-r03-keepsake",
  "c2-r01-protect-daiyu",
  "c2-r02-steady-lantern",
  "c2-r03-protect-letter",
  "c3-r01-catch-jade",
  "c3-r02-shield-daiyu",
  "c3-r03-call-jiamu",
  "c3-r04-let-fall",
] as const;

const endingIds = [
  "c4-e01-trust-daiyu",
  "c4-e02-hand-xifeng",
  "c4-e03-keep-letter",
  "c4-e04-destroy-leave",
  "c4-e05-unwritten",
] as const;

const chapterDurations = [59.75, 29.76, 178.12, 89.03] as const;

export const JINLING_INTERACTIVE_FILM_ASSETS: InteractiveFilmAsset[] = [
  video("p00/ledger-confirm-16x9-v01.mp4", "prologue", 6),
  video("p00/ledger-confirm-16x9-v03.mp4", "prologue", 6),
  video("p00/ledger-opening-16x9-v01.mp4", "prologue", 12),
  video("p00/ledger-opening-16x9-v03.mp4", "prologue", 12),
  video("p00/ledger-to-carriage-transition-16x9-v01.mp4", "prologue", 12),
  video("p00/water-establishing-16x9-v01.mp4", "prologue", 8),
  ...mainIds.map((id) => video(`film-cut-v2/${id}.mp4`, "main")),
  ...reactionIds.map((id) => video(`film-cut-v2/${id}.mp4`, "reaction")),
  ...endingIds.map((id) => video(`film-cut-v2/${id}.mp4`, "ending")),
  ...chapterDurations.map((duration, index) =>
    video(`film-cut-v2/chapters/c${index + 1}.mp4`, "chapter", duration)
  ),
  audio("s01-p00-ambience-v1.wav"),
  audio("s01-p00-b01-vo-01-v1.wav"),
  audio("s01-p00-b01-vo-02-v1.wav"),
  audio("s01-p00-b02-vo-01-v1.wav"),
  audio("s01-p00-b03-vo-01-v1.wav"),
  audio("s01-p00-confirm-mix-v1.wav"),
  audio("s01-p00-opening-mix-v1.wav"),
];

const assetId = (relativePath: string) => relativePath.replace(/\.mp4$/, "").replaceAll("/", ":");
const mainAssetId = (id: string) => assetId(`film-cut-v2/${id}.mp4`);
const chapterAssetId = (id: string) => assetId(`film-cut-v2/chapters/${id}.mp4`);

export const JINLING_INTERACTIVE_FILM_DRAFT: InteractiveFilmCreatorDraft = {
  schemaVersion: "story-studio-interactive-film-v1",
  projectId: "official-example-jinling-rumeng",
  mode: "interactive-film",
  title: "金陵入梦",
  subtitle: "第一季 · 无字来客",
  orientation: "landscape-only",
  entrySceneId: "c1",
  scenes: [
    {
      sceneId: "c1",
      number: 1,
      eyebrow: "入府",
      title: "荐书叩门",
      summary: "玩家从秦淮车厢醒来，与黛玉同日抵达荣国府，并第一次为自己的来处作证。",
      masterAssetId: chapterAssetId("c1"),
      sequenceAssetIds: mainIds.slice(0, 4).map(mainAssetId),
      choices: [
        {
          choiceId: "oldTrust",
          label: "如实说明受故人所托",
          reactionAssetId: mainAssetId("c1-r01-old-trust"),
          targetSceneId: "c2",
        },
        {
          choiceId: "daiyuRoad",
          label: "借黛玉同行的来路作证",
          reactionAssetId: mainAssetId("c1-r02-daiyu-road"),
          targetSceneId: "c2",
        },
        {
          choiceId: "keepsake",
          label: "只出示信物，不作解释",
          reactionAssetId: mainAssetId("c1-r03-keepsake"),
          targetSceneId: "c2",
        },
      ],
    },
    {
      sceneId: "c2",
      number: 2,
      eyebrow: "游廊",
      title: "风灯危局",
      summary: "穿堂风卷起灯火、衣袖和荐书，玩家必须先保护一样。",
      masterAssetId: chapterAssetId("c2"),
      sequenceAssetIds: mainIds.slice(4, 6).map(mainAssetId),
      choices: [
        {
          choiceId: "protectDaiyu",
          label: "先替黛玉解开衣袖",
          reactionAssetId: mainAssetId("c2-r01-protect-daiyu"),
          targetSceneId: "c3",
        },
        {
          choiceId: "steadyLantern",
          label: "先稳住风灯",
          reactionAssetId: mainAssetId("c2-r02-steady-lantern"),
          targetSceneId: "c3",
        },
        {
          choiceId: "protectLetter",
          label: "先护住荐书与淡红印",
          reactionAssetId: mainAssetId("c2-r03-protect-letter"),
          targetSceneId: "c3",
        },
      ],
    },
    {
      sceneId: "c3",
      number: 3,
      eyebrow: "荣府",
      title: "贾母、熙凤与摔玉",
      summary: "玩家进入荣府关系核心，经历贾母认亲、熙凤试探与宝玉摔玉。",
      masterAssetId: chapterAssetId("c3"),
      sequenceAssetIds: mainIds.slice(6, 18).map(mainAssetId),
      choices: [
        {
          choiceId: "catchJade",
          label: "接住通灵宝玉",
          reactionAssetId: mainAssetId("c3-r01-catch-jade"),
          targetSceneId: "c4",
        },
        {
          choiceId: "shieldDaiyu",
          label: "挡在黛玉与落玉之间",
          reactionAssetId: mainAssetId("c3-r02-shield-daiyu"),
          targetSceneId: "c4",
        },
        {
          choiceId: "callJiamu",
          label: "唤贾母主持局面",
          reactionAssetId: mainAssetId("c3-r03-call-jiamu"),
          targetSceneId: "c4",
        },
        {
          choiceId: "letFall",
          label: "不作干预",
          reactionAssetId: mainAssetId("c3-r04-let-fall"),
          targetSceneId: "c4",
        },
      ],
    },
    {
      sceneId: "c4",
      number: 4,
      eyebrow: "夜谈",
      title: "谁来书写命运",
      summary: "黛玉识破荐书异常，玩家决定由谁保管这张不属于旧命册的纸。",
      masterAssetId: chapterAssetId("c4"),
      sequenceAssetIds: mainIds.slice(18).map(mainAssetId),
      choices: [
        {
          choiceId: "daiyu",
          label: "把荐书交给黛玉",
          reactionAssetId: mainAssetId("c4-e01-trust-daiyu"),
          endingId: "e01",
        },
        {
          choiceId: "xifeng",
          label: "把荐书交给熙凤",
          reactionAssetId: mainAssetId("c4-e02-hand-xifeng"),
          endingId: "e02",
        },
        {
          choiceId: "keep",
          label: "自己留下荐书",
          reactionAssetId: mainAssetId("c4-e03-keep-letter"),
          endingId: "e03",
        },
        {
          choiceId: "burn",
          label: "烧毁荐书，离开荣府",
          reactionAssetId: mainAssetId("c4-e04-destroy-leave"),
          endingId: "e04",
        },
      ],
    },
  ],
  endings: [
    { endingId: "e01", title: "同为客", assetId: mainAssetId("c4-e01-trust-daiyu") },
    { endingId: "e02", title: "府中有位", assetId: mainAssetId("c4-e02-hand-xifeng") },
    { endingId: "e03", title: "无字命册", assetId: mainAssetId("c4-e03-keep-letter") },
    { endingId: "e04", title: "天明归去", assetId: mainAssetId("c4-e04-destroy-leave") },
    {
      endingId: "e05",
      title: "玉碎梦醒",
      assetId: mainAssetId("c4-e05-unwritten"),
      fallback: true,
    },
  ],
};

export const JINLING_INTERACTIVE_FILM_STORAGE_KEY =
  "fizzdragon.story-studio.interactive-film.jinling.v1";
