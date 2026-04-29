/**
 * Deterministic mock content for the IP detail page (titles, story copy,
 * trailers, episode list, team, updates, FAQs). Used as a per-field
 * fallback while the corresponding backend fields are still being built;
 * delete each consumer as the real hooks land.
 */

// ─── Hash helpers ─────────────────────────────────────

/** Simple deterministic 32-bit string hash (FNV-ish). Plenty for picking
 *  bucketed mock values per id. */
function hashId(id: number | string): number {
  const s = String(id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
  }
  return Math.abs(h);
}

/** Stable PRNG seeded by id+salt — gives different streams of values for
 *  different fields of the same project. */
function seeded(id: number | string, salt: string, mod: number): number {
  return hashId(`${id}:${salt}`) % mod;
}

// ─── Tag helpers ──────────────────────────────────────

/** Backend stores tags as a single string (comma / pipe / semi-colon /
 *  space separated, varies by data origin). Split tolerantly. */
export function splitTags(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[,|;、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Stable color hash for an avatar fallback initial. */
const AVATAR_COLORS = [
  "bg-amber-500/20 text-amber-300",
  "bg-rose-500/20 text-rose-300",
  "bg-violet-500/20 text-violet-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-sky-500/20 text-sky-300",
  "bg-fuchsia-500/20 text-fuchsia-300",
];

export function avatarFallbackTone(seed: string | number | null | undefined): string {
  if (seed === null || seed === undefined) return AVATAR_COLORS[0];
  return AVATAR_COLORS[hashId(String(seed)) % AVATAR_COLORS.length];
}

// ─── Detail-page mock content ────────────────────────
//
// Deterministic mock for the IP detail page. Fills in trailer / cover /
// episodes / team / updates / FAQs / story copy so the page demos cleanly
// without a real backend. Replace each consumer with the real hook as
// endpoints land — see `apps/web/app/(site)/ips/README.md`.

// Public sample MP4s from Google's gtv-videos-bucket (CORS-friendly).
// Used as trailer + per-episode media so the player actually plays.
const SAMPLE_VIDEOS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Subaru_Outback_On_Street_And_Dirt.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WhatCarCanYouGetForAGrand.mp4",
] as const;

const STORY_POOL = [
  "2099 年，霓虹与雨水浸透的远东都市。一群普通人因为同一段被遗忘的代码相遇，他们要做的事情简单又残酷：把一个被关进数据深处的人捞出来。",
  "古蜀国的山林深处，最后一座青铜祭坛即将熄灭。少年祭司被告知，他必须独自走完这段被神族放弃的路 —— 只有他还记得起源的祷词。",
  "末日来临前的最后一夜，一通永远不会被接听的电话改变了所有人的命运。当太阳重新升起时，世界已经不再是他们离开时的模样。",
  "AI 占领银幕的第十年，一位老剧作家决定亲自拍摄一部完全由人类讲述、人类演出、人类剪辑的电影。然后，他的助手发来了一封很长的拒信。",
];

const WHY_POOL = [
  "我们想用一群创作者最熟悉的工具，重新讲一个东亚观众真正在乎的故事。AIGC 不是噱头 —— 它让小团队也有能力去拍、去试、去推翻重来。",
  "传统流程把故事关在工业流水线里，留给作者的只有 30% 的发挥空间。我们要做的事，是把那剩下 70% 还给真正会讲故事的人。",
  "市面上的 AI 短剧大多在追逐流量爆点，质感和叙事都是牺牲品。这部作品想证明：节奏、人物、镜头语言，AI 都可以做到不输传统制作。",
];

const EP_TITLES = [
  "序章 · 觉醒",
  "第一道光",
  "迷雾下的城邦",
  "命运的齿轮",
  "失落的祷词",
  "破晓之约",
  "归途与岔路",
  "最后的回响",
  "白夜与灰烬",
  "未完之歌",
];

const EP_DESC_POOL = [
  "故事真正开始的地方。主角第一次意识到自己并非独自一人，但代价是失去了原本的庇护。",
  "节奏放缓的一集，我们看到这个世界更柔软的部分 —— 也是接下来一切冲突的伏笔。",
  "动作戏比例最重的一集。一场雨夜追逐贯穿全程，配乐由项目里两位作曲家联手完成。",
  "几乎没有对白的实验性剧集。镜头跟着一只老猫走过整座城市，捎带交代了三条暗线。",
  "本季最大的揭露落在结尾两分钟。请务必看到 staff 字幕跑完。",
];

const TEAM_NAMES_ROLES = [
  { name: "陈泽川", role: "总导演" },
  { name: "李墨然", role: "美术总监" },
  { name: "Alex Tanaka", role: "AI 制片" },
  { name: "周渔", role: "音乐制作" },
  { name: "Sarah K.", role: "剧本统筹" },
  { name: "黄启航", role: "动画指导" },
];

const UPDATE_POOL = [
  {
    title: "第一集正片上线",
    content: "经过四个月的筹备，第一集正式与大家见面。感谢所有早鸟支持者一路陪我们走到这里。",
  },
  {
    title: "工作流大调整",
    content:
      "我们彻底重写了剧本到分镜的中间环节，新流程让单集制作时间缩短了一半。下一集会以新流程产出。",
  },
  {
    title: "新成员加入",
    content: "音乐制作 Lily 正式加入我们，她将负责接下来三集的原声配乐。欢迎她！",
  },
  {
    title: "官方周边即将开放预订",
    content: "首批限量周边将在下月初开放预订，超级粉丝档位用户可在公开发售前 48 小时提前下单。",
  },
];

const FAQ_POOL = [
  {
    q: "什么时候可以看到第一集？",
    a: "如果一切顺利，我们计划在筹备阶段结束后 6–8 周内上线第一集。具体时间会通过 IP 详情页和邮件通知你。",
  },
  {
    q: "支持哪些设备 / 平台？",
    a: "Web 端（Chrome / Safari）和 iOS / Android 移动端都可以观看。后续会上线 TV 端 Cast 支持。",
  },
  {
    q: "如何成为联合制片人？",
    a: "在右侧权益卡中选择「联合制片人」档位，完成支付后我们的运营团队会在 3 个工作日内联系你确认署名等信息。",
  },
  {
    q: "如果项目没有按计划上线，我的钱会怎么处理？",
    a: "我们会按照平台规则，根据筹备阶段、制作进度等情况进行部分或全额退款。具体规则可以查看《制片协议》第 7 条。",
  },
  {
    q: "数字周边和实体周边什么时候发？",
    a: "数字周边在你完成支付后立即解锁；实体周边会在制作中后期统一寄出，发货前会通过邮件二次确认收货地址。",
  },
];

const TAG_POOL = [
  ["AI 动画", "赛博朋克", "悬疑", "短剧"],
  ["奇幻", "国风", "冒险", "群像"],
  ["科幻", "末日", "动作", "AIGC"],
  ["治愈", "日常", "实验影像"],
];

const TITLE_POOL = [
  "霓虹之锚",
  "蜀山·余烬",
  "晨曦电报",
  "末日时刻",
  "灰盐之城",
  "未尽之歌",
  "白夜剧院",
  "纸星辰",
];

const TAGLINE_POOL = [
  "一段被遗忘的代码，一群被时代抛下的人。",
  "当神族沉睡，凡人的祷词成为最后的火种。",
  "她拨通了一个永远不会被接听的号码。",
  "AI 占领银幕的第十年，最后一部人类电影。",
];

// Picsum gives us deterministic-by-seed cover images and avatars without
// needing to host anything ourselves.
function picsum(seed: string, w: number, h: number): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

function pick<T>(id: string | number, salt: string, pool: readonly T[]): T {
  return pool[seeded(id, salt, pool.length)];
}

export interface IPMockEpisode {
  id: string;
  title: string;
  description: string;
  videoUrl: string;
  cover: string;
  duration: number;
  sort: number;
}

export interface IPMockTeamMember {
  name: string;
  role: string;
  avatar: string;
  level: string;
}

export interface IPMockDetailContent {
  title: string;
  tagline: string;
  trailerUrl: string;
  /** Landscape key-art (16:9). */
  cover: string;
  tags: string[];
  story: string;
  whyThisIP: string;
  episodes: IPMockEpisode[];
  team: IPMockTeamMember[];
  updates: { date: string; title: string; content: string }[];
  faqs: { q: string; a: string }[];
}

export function mockIPDetailContent(id: string | number): IPMockDetailContent {
  const sid = String(id);
  const epCount = 6 + seeded(sid, "epc", 5); // 6–10
  const teamCount = 3 + seeded(sid, "tc", 3); // 3–5
  const updatesCount = 2 + seeded(sid, "uc", 3); // 2–4
  const faqCount = 3 + seeded(sid, "fc", 3); // 3–5

  const episodes: IPMockEpisode[] = Array.from({ length: epCount }, (_, i) => {
    const sort = i + 1;
    return {
      id: `mock-ep-${sid}-${sort}`,
      title: EP_TITLES[(seeded(sid, `ep-t-${sort}`, EP_TITLES.length) + i) % EP_TITLES.length],
      description: pick(sid, `ep-d-${sort}`, EP_DESC_POOL),
      videoUrl: SAMPLE_VIDEOS[(hashId(`${sid}-${sort}`) >>> 0) % SAMPLE_VIDEOS.length],
      cover: picsum(`${sid}-ep-${sort}`, 640, 360),
      duration: 240 + seeded(sid, `ep-dur-${sort}`, 1200), // 4 min – 24 min
      sort,
    };
  });

  const team: IPMockTeamMember[] = Array.from({ length: teamCount }, (_, i) => {
    const member =
      TEAM_NAMES_ROLES[
        (seeded(sid, `tm-${i}`, TEAM_NAMES_ROLES.length) + i) % TEAM_NAMES_ROLES.length
      ];
    return {
      name: member.name,
      role: member.role,
      avatar: picsum(`${sid}-tm-${i}`, 160, 160),
      level: `FD${1 + seeded(sid, `tm-l-${i}`, 5)}`,
    };
  });

  const today = Date.now();
  const updates = Array.from({ length: updatesCount }, (_, i) => {
    const item = UPDATE_POOL[(seeded(sid, `up-${i}`, UPDATE_POOL.length) + i) % UPDATE_POOL.length];
    const daysAgo = (i + 1) * (3 + seeded(sid, `up-d-${i}`, 10));
    return {
      date: new Date(today - daysAgo * 86400000).toISOString().slice(0, 10),
      title: item.title,
      content: item.content,
    };
  });

  const faqs = Array.from(
    { length: faqCount },
    (_, i) => FAQ_POOL[(seeded(sid, `faq-${i}`, FAQ_POOL.length) + i) % FAQ_POOL.length]
  );

  return {
    title: pick(sid, "title", TITLE_POOL),
    tagline: pick(sid, "tagline", TAGLINE_POOL),
    trailerUrl: SAMPLE_VIDEOS[seeded(sid, "trailer", SAMPLE_VIDEOS.length)],
    cover: picsum(`${sid}-cover`, 1600, 900),
    tags: pick(sid, "tags", TAG_POOL),
    story: pick(sid, "story", STORY_POOL),
    whyThisIP: pick(sid, "why", WHY_POOL),
    episodes,
    team,
    updates,
    faqs,
  };
}
