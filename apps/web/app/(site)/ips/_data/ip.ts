/**
 * IP feature — UI types and config constants.
 *
 * These describe the front-end shape used by the IP detail / create flows.
 * They overlap with but are not identical to the backend `Project` shape:
 * the IP UI carries production plans, FAQs, episode lists, reward tiers,
 * etc. that the backend doesn't yet model. As the API expands, expect to
 * trim fields here and lean more on `useProjectDetail`.
 *
 * No mock data lives in this file. Initial values come from real hooks;
 * fields the API doesn't supply default to empty arrays / strings at the
 * call site.
 */

// ─── Stage ───────────────────────────────────────────

export type IPStage = "investment" | "presale" | "producing" | "released";

export interface IPItem {
  id: string;
  title: string;
  author: string;
  authorLevel: string;
  cover: string;
  desc: string;
  tags: string[];
  stage: IPStage;

  // investment
  valuation?: number;
  sharesOffered?: number;
  pricePerShare?: number;
  totalShares?: number;
  sharesSold?: number;

  // presale
  presalePrice?: number;
  fullPrice?: number;
  presaleTarget?: number;
  presaleCurrent?: number;
  presaleDeadline?: string;

  // producing / released
  episodes?: number;
  targetEpisodes?: number;
  progress?: number;
  watchPrice?: number;

  trailer: boolean;
  views: number;
  likes: number;
  featured: boolean;
  updatedAt: string;
}

export interface StageStyle {
  labelKey: string;
  badge: string;
  dot: string;
}

export const STAGE_CONFIG: Record<IPStage, StageStyle> = {
  investment: {
    labelKey: "stageFundraising",
    badge: "text-amber-400 bg-amber-400/10 border-amber-400/30",
    dot: "bg-amber-400",
  },
  presale: {
    labelKey: "stagePresale",
    badge: "text-blue-400 bg-blue-400/10 border-blue-400/30",
    dot: "bg-blue-400",
  },
  producing: {
    labelKey: "stageProducing",
    badge: "text-violet-400 bg-violet-400/10 border-violet-400/30",
    dot: "bg-violet-400",
  },
  released: {
    labelKey: "stageReleased",
    badge: "text-green-400 bg-green-400/10 border-green-400/30",
    dot: "bg-green-400",
  },
};

export const FUNDING_STAGES = [
  { value: "all", labelKey: "filterAll" },
  { value: "investment", labelKey: "filterInvestment", descKey: "filterInvestmentDesc" },
  { value: "presale", labelKey: "filterPresale", descKey: "filterPresaleDesc" },
  { value: "producing", labelKey: "filterProducing", descKey: "filterProducingDesc" },
  { value: "released", labelKey: "filterReleased", descKey: "filterReleasedDesc" },
] as const;

// ─── Detail types ────────────────────────────────────

export interface IPProductionPhase {
  phase: string;
  timeline: string;
  status: "completed" | "in_progress" | "pending";
  description: string;
}

export interface IPTeamMember {
  name: string;
  role: string;
  avatar: string;
  level: string;
  projects: number;
  rating: number;
  certified?: boolean;
}

export interface IPUpdate {
  date: string;
  title: string;
  content: string;
}

export interface IPEpisode {
  number: number;
  title: string;
  price: number;
  free: boolean;
}

export interface IPFAQ {
  q: string;
  a: string;
}

export interface IPDetail extends IPItem {
  tagline: string;
  story: string;
  whyThisIP: string;
  productionPlan: IPProductionPhase[];
  team: IPTeamMember[];
  updates: IPUpdate[];
  episodeList: IPEpisode[];
  bundlePrice: number;
  singleTotal: number;
  faqs: IPFAQ[];
}

export const PLAN_STATUS_CLASS: Record<string, string> = {
  completed: "border-green-400/30 bg-green-400/5 text-green-400",
  in_progress: "border-blue-400/30 bg-blue-400/5 text-blue-400",
  pending: "border-border bg-muted/50 text-muted-foreground",
};

/**
 * Empty `IPDetail` skeleton used as a fallback while the real project
 * is loading or when the API doesn't yet provide a given section.
 * Sections that resolve to empty arrays / strings render as no-ops in
 * the detail page, so the UI degrades gracefully.
 */
export const EMPTY_IP_DETAIL: IPDetail = {
  id: "",
  title: "",
  author: "",
  authorLevel: "",
  cover: "",
  desc: "",
  tags: [],
  stage: "investment",
  trailer: false,
  views: 0,
  likes: 0,
  featured: false,
  updatedAt: "",
  tagline: "",
  story: "",
  whyThisIP: "",
  productionPlan: [],
  team: [],
  updates: [],
  episodeList: [],
  bundlePrice: 0,
  singleTotal: 0,
  faqs: [],
};

// ─── Create form ─────────────────────────────────────

export interface IPRewardTier {
  id: string;
  title: string;
  amount: number;
  description: string;
  perks: string[];
}

export interface IPCreateForm {
  title: string;
  projectType: string;
  description: string;
  tags: string[];
  coverImage: string | null;
  story: string;
  whyThisIP: string;
  targetEpisodes: number;
  fundingMode: "investment" | "presale";
  valuation: string;
  sharesOffered: string;
  totalShares: string;
  deadline: string;
  presalePrice: number;
  fullPrice: number;
  presaleTarget: number;
  presaleDeadline: string;
  rewards: IPRewardTier[];
}

export const PROJECT_TYPES = [
  "ipDevelopment",
  "series",
  "brandShort",
  "commercial",
  "creativeExperiment",
] as const;

export const TARGET_EPISODES_OPTIONS = [3, 6, 8, 10, 12, 15] as const;

export const SUGGESTED_TAGS = [
  "AI动画",
  "AI绘画",
  "赛博朋克",
  "奇幻",
  "科幻",
  "日常",
  "动作",
  "悬疑",
  "治愈",
  "国风",
  "机甲",
  "末日",
  "校园",
  "恋爱",
] as const;

export const PRESET_REWARDS: IPRewardTier[] = [
  {
    id: "preset-30",
    title: "支持者",
    amount: 30,
    description: "感谢你的支持！",
    perks: ["数字感谢卡", "支持者专属壁纸", "项目动态通知"],
  },
  {
    id: "preset-100",
    title: "早鸟",
    amount: 100,
    description: "抢先观看全部内容",
    perks: ["全集抢先看", "幕后花絮", "创作者交流群", "数字感谢卡"],
  },
  {
    id: "preset-300",
    title: "超级粉丝",
    amount: 300,
    description: "深度参与创作过程",
    perks: ["全集抢先看", "幕后花絮", "角色命名投票", "限量周边", "创作者交流群", "片尾鸣谢"],
  },
  {
    id: "preset-1000",
    title: "联合制片人",
    amount: 1000,
    description: "成为项目的一部分",
    perks: [
      "联合制片人署名",
      "全套周边礼包",
      "线下见面会",
      "剧情建议权",
      "全集抢先看",
      "幕后花絮",
      "创作者交流群",
    ],
  },
];

export function createEmptyIPForm(): IPCreateForm {
  return {
    title: "",
    projectType: "",
    description: "",
    tags: [],
    coverImage: null,
    story: "",
    whyThisIP: "",
    targetEpisodes: 6,
    fundingMode: "investment",
    valuation: "",
    sharesOffered: "",
    totalShares: "",
    deadline: "",
    presalePrice: 30,
    fullPrice: 100,
    presaleTarget: 100,
    presaleDeadline: "",
    rewards: [],
  };
}
