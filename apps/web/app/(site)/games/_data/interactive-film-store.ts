import type { Locale } from "@/src/i18n/config";

/**
 * MOCK-ONLY — store review round (2026-10-02).
 *
 * The interactive-film store dialog currently renders from this fixture so the
 * layout can be reviewed before a store-detail API contract exists. Once the
 * real endpoint lands (rich detail payload behind the existing
 * `/api/player/interactive-film` catalogue), delete this file and feed the
 * dialog from real data instead. Nothing outside this directory may
 * import from it.
 */

export type StoreMediaItem =
  | { kind: "video"; url: string; posterUrl: string }
  | { kind: "image"; url: string; alt: string };

export interface LocalizedStoreContent {
  title: string;
  tagline: string;
  shortDescription: string;
  aboutParagraphs: string[];
  genres: string[];
  tags: string[];
}

export interface StoreEntry {
  gameId: string;
  coverUrl: string;
  media: StoreMediaItem[];
  /** ISO date — rendered with Intl per viewer locale. */
  releaseDate: string;
  developer: string;
  publisher: string;
  languages: string[];
  playersNow: number;
  content: Record<Locale, LocalizedStoreContent>;
}

const JINLING_STILLS = "/jinling-rumeng/preview/story";

export const MOCK_STORE_CATALOG: readonly StoreEntry[] = [
  {
    gameId: "jinling-rumeng",
    coverUrl: `${JINLING_STILLS}/sc03-lantern.png`,
    media: [
      {
        kind: "video",
        url: "/_dev/tv/jinling.mp4",
        posterUrl: `${JINLING_STILLS}/sc09-daiyu-night.png`,
      },
      { kind: "image", url: `${JINLING_STILLS}/sc02-daiyu.png`, alt: "Jade in the bamboo court" },
      { kind: "image", url: `${JINLING_STILLS}/sc05-xifeng.png`, alt: "The corridor council" },
      {
        kind: "image",
        url: `${JINLING_STILLS}/sc06-boundary.png`,
        alt: "The boundary wall at dusk",
      },
      {
        kind: "image",
        url: `${JINLING_STILLS}/sc07-baoyu.png`,
        alt: "Baoyu by the reflecting pool",
      },
      { kind: "image", url: `${JINLING_STILLS}/sc10-letter.png`, alt: "The unfinished letter" },
      { kind: "image", url: `${JINLING_STILLS}/ending-water.png`, alt: "The water ending" },
    ],
    releaseDate: "2026-08-22",
    developer: "Rumeng Crew",
    publisher: "FizzDragon",
    languages: ["简体中文", "English", "繁體中文"],
    playersNow: 1284,
    content: {
      "en-US": {
        title: "Jinling: The Dream",
        tagline: "A cinematic interactive film where every choice rewrites the garden.",
        shortDescription:
          "Step inside a living Dream of the Red Chamber. Your dialogue, your timing, your silences — the garden answers all of it, across nine endings shot like film, not rendered like a game.",
        aboutParagraphs: [
          "Jinling: The Dream is a fully cinematic interactive film. Every scene is directed, lit, and edited like a period drama — but the script is yours. Conversations branch on what you say, when you stay silent, and who you choose to stand beside.",
          "The garden remembers. Decisions in chapter one ripple into chapter three: a lantern given away returns as an ally, a withheld kindness returns as an absence. Nine distinct endings wait past the boundary wall.",
          "Built on FizzDragon's AI film pipeline by the Rumeng Crew — writers, storyboard artists, and directors collaborating in one studio — every frame was generated, then directed, by humans.",
        ],
        genres: ["Drama", "Romance", "Mystery"],
        tags: [
          "Story rich",
          "Choices matter",
          "Cinematic",
          "Multiple endings",
          "Singleplayer",
          "AI-assisted art",
        ],
      },
      "zh-CN": {
        title: "金陵入梦",
        tagline: "一部电影质感的互动影游，你的每一次落笔都在改写这座大观园。",
        shortDescription:
          "走进一部活的《红楼梦》。你的台词、你的时机、你的沉默——园子全都记得，并以九种电影级结局回应你。",
        aboutParagraphs: [
          "《金陵入梦》是一部完全电影化的互动影游。每一场戏都按古装正片的标准打光、运镜、剪辑——但剧本由你来写。对话会因你说什么、何时沉默、站在谁身边而走向不同分支。",
          "园子有记忆。第一章的决定会一路回响到第三章：送出去的一盏灯日后会变成一位盟友，一次没给出的善意日后会变成一个空缺。高墙之内，九种截然不同的结局等你抵达。",
          "由「金陵入梦」剧组在 FizzDragon 的 AI 影片流水线上共同创作——编剧、分镜师、导演在同一个工作台里协作——每一帧都由 AI 生成、再由人类执导完成。",
        ],
        genres: ["剧情", "爱情", "悬疑"],
        tags: ["剧情向", "选择取向", "电影化", "多结局", "单人", "AI 辅助美术"],
      },
      "zh-HK": {
        title: "金陵入夢",
        tagline: "一部電影質感的互動影遊，你的每一次落筆都在改寫這座大觀園。",
        shortDescription:
          "走進一部活的《紅樓夢》。你的台詞、你的時機、你的沉默——園子全都記得，並以九種電影級結局回應你。",
        aboutParagraphs: [
          "《金陵入夢》是一部完全電影化的互動影遊。每一場戲都按古裝正片的標準打光、運鏡、剪接——但劇本由你來寫。對話會因你說什麼、何時沉默、站在誰身邊而走向不同分支。",
          "園子有記憶。第一章的決定會一路迴響到第三章：送出去的一盞燈日後會變成一位盟友，一次沒給出的善意日後會變成一個空缺。高牆之內，九種截然不同的結局等你抵達。",
          "由「金陵入夢」劇組在 FizzDragon 的 AI 影片流水線上共同創作——編劇、分鏡師、導演在同一個工作台裡協作——每一幀都由 AI 生成、再由人類執導完成。",
        ],
        genres: ["劇情", "愛情", "懸疑"],
        tags: ["劇情向", "選擇取向", "電影化", "多結局", "單人", "AI 輔助美術"],
      },
    },
  },
  {
    gameId: "lunar-armor",
    coverUrl: "/made-with-fizz/lunar-colony.jpg",
    media: [
      {
        kind: "video",
        url: "/_dev/tv/lunar-colony.mp4",
        posterUrl: "/made-with-fizz/lunar-colony.jpg",
      },
      { kind: "image", url: "/made-with-fizz/lunar-colony.jpg", alt: "Lunar Armor colony key art" },
    ],
    releaseDate: "2026-09-05",
    developer: "Regolith Workshop",
    publisher: "FizzDragon",
    languages: ["简体中文", "English"],
    playersNow: 412,
    content: {
      "en-US": {
        title: "Lunar Armor",
        tagline: "Fourteen minutes of air. One armor. No second take.",
        shortDescription:
          "A hard-sci-fi interactive short film on the far side of the Moon. Every second of oxygen is a choice, and the suit narrates what you are about to lose.",
        aboutParagraphs: [
          "Lunar Armor drops you inside a failing exosuit on the far side of the Moon with fourteen minutes of breathable air. Repair, retreat, or push for the relay — the film re-edits itself around your calls.",
          "Shot with weightless cameras and a sound design that treats vacuum as silence, not noise.",
        ],
        genres: ["Sci-fi", "Thriller"],
        tags: ["Short", "Hard sci-fi", "Tense", "Singleplayer"],
      },
      "zh-CN": {
        title: "月甲",
        tagline: "十四分钟的氧气，一副装甲，没有第二条拍的余地。",
        shortDescription:
          "一部发生在月球背面的硬科幻互动短片。每一秒氧气都是一次选择，而装甲会在你失去之前，替你念出倒计时。",
        aboutParagraphs: [
          "《月甲》把你丢进月球背面一副正在解体的外骨骼装甲里，剩余氧气十四分钟。修复、撤退、或者冲向中继站——影片会围绕你的每个决定重新剪辑自己。",
          "以失重感的镜头，和把真空当作寂静而非噪音的声音设计完成。",
        ],
        genres: ["科幻", "惊悚"],
        tags: ["短片", "硬科幻", "紧张刺激", "单人"],
      },
      "zh-HK": {
        title: "月甲",
        tagline: "十四分鐘的氧氣，一副裝甲，沒有第二條拍的餘地。",
        shortDescription:
          "一部發生在月球背面的硬科幻互動短片。每一秒氧氣都是一次選擇，而裝甲會在你失去之前，替你念出倒計時。",
        aboutParagraphs: [
          "《月甲》把你丟進月球背面一副正在解體的外骨骼裝甲裡，剩餘氧氣十四分鐘。修復、撤退、或者衝向中繼站——影片會圍繞你的每個決定重新剪輯自己。",
          "以失重感的鏡頭，和把真空當作寂靜而非噪音的聲音設計完成。",
        ],
        genres: ["科幻", "驚悚"],
        tags: ["短片", "硬科幻", "緊張刺激", "單人"],
      },
    },
  },
  {
    gameId: "three-second-world",
    coverUrl: "/made-with-fizz/three-second-world.jpg",
    media: [
      {
        kind: "video",
        url: "/_dev/tv/three-second-world.mp4",
        posterUrl: "/made-with-fizz/three-second-world.jpg",
      },
      {
        kind: "image",
        url: "/made-with-fizz/three-second-world.jpg",
        alt: "Three Second World key art",
      },
    ],
    releaseDate: "2026-09-26",
    developer: "Split-Frame Collective",
    publisher: "FizzDragon",
    languages: ["简体中文", "English"],
    playersNow: 268,
    content: {
      "en-US": {
        title: "Three Second World",
        tagline: "The city resets every three seconds. You keep one thing.",
        shortDescription:
          "An experimental interactive film built on a three-second loop. Choose what survives each reset — and watch a city grow from what you refuse to let go.",
        aboutParagraphs: [
          "Every three seconds the frame folds back on itself. Between folds you may carry exactly one thing forward: a face, a sentence, a door left open. The city that emerges after a hundred loops is a map of everything you refused to drop.",
        ],
        genres: ["Experimental", "Puzzle"],
        tags: ["Experimental", "Replayable", "Mind-bending", "Singleplayer"],
      },
      "zh-CN": {
        title: "三秒世界",
        tagline: "城市每三秒重置一次，你只能带走一件东西。",
        shortDescription:
          "一部建立在三秒循环之上的实验互动影游。决定每一次重置后留下什么——然后看这座城，如何由你不肯放手的一切生长而成。",
        aboutParagraphs: [
          "画面每三秒就会对折回自己。两次对折之间，你只能带一样东西继续往前：一张脸、一句话、一扇没关的门。一百次循环之后浮现出的城市，就是你拒绝放下之物的地图。",
        ],
        genres: ["实验", "解谜"],
        tags: ["实验性", "耐玩", "烧脑", "单人"],
      },
      "zh-HK": {
        title: "三秒世界",
        tagline: "城市每三秒重置一次，你只能帶走一件東西。",
        shortDescription:
          "一部建立在三秒循環之上的實驗互動影遊。決定每一次重置後留下什麼——然後看這座城，如何由你不肯放手的一切生長而成。",
        aboutParagraphs: [
          "畫面每三秒就會對摺回自己。兩次對摺之間，你只能帶一樣東西繼續往前：一張臉、一句話、一扇沒關的門。一百次循環之後浮現出的城市，就是你拒絕放下之物的地圖。",
        ],
        genres: ["實驗", "解謎"],
        tags: ["實驗性", "耐玩", "燒腦", "單人"],
      },
    },
  },
];

export function findMockStoreEntry(gameId: string): StoreEntry | undefined {
  return MOCK_STORE_CATALOG.find((entry) => entry.gameId === gameId);
}
