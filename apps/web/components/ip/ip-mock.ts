// ─── Types ───────────────────────────────────────────

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

// ─── Stage config ────────────────────────────────────

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

// ─── Funding stage filters ───────────────────────────

export const FUNDING_STAGES = [
  { value: "all", labelKey: "filterAll" },
  { value: "investment", labelKey: "filterInvestment", descKey: "filterInvestmentDesc" },
  { value: "presale", labelKey: "filterPresale", descKey: "filterPresaleDesc" },
  { value: "producing", labelKey: "filterProducing", descKey: "filterProducingDesc" },
  { value: "released", labelKey: "filterReleased", descKey: "filterReleasedDesc" },
] as const;

// ─── Mock data ───────────────────────────────────────

export const MOCK_IPS: IPItem[] = [
  {
    id: "ip1",
    title: "赛博山海经",
    author: "影子工作室",
    authorLevel: "FD4",
    cover: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=600&q=80",
    desc: "将《山海经》古老神话与赛博朋克世界观融合，构建一个完整的东方未来宇宙。",
    tags: ["赛博朋克", "神话新编", "东方美学"],
    stage: "investment",
    valuation: 1000000,
    sharesOffered: 20,
    pricePerShare: 200000,
    totalShares: 5,
    sharesSold: 3,
    trailer: true,
    episodes: 0,
    targetEpisodes: 10,
    views: 12400,
    likes: 893,
    featured: true,
    updatedAt: "2026-03-22",
  },
  {
    id: "ip2",
    title: "深港纪事",
    author: "浪潮导演",
    authorLevel: "FD3",
    cover: "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=600&q=80",
    desc: "以虚构的海滨港口小镇为背景，五个家族在时代浪潮中离散与重逢。剧本已完成，现开放预售。",
    tags: ["悬疑", "人文", "现实主义"],
    stage: "presale",
    presalePrice: 30,
    fullPrice: 100,
    presaleTarget: 100,
    presaleCurrent: 67,
    presaleDeadline: "2026-04-30",
    trailer: true,
    episodes: 0,
    targetEpisodes: 6,
    views: 8700,
    likes: 541,
    featured: false,
    updatedAt: "2026-03-24",
  },
  {
    id: "ip3",
    title: "霓虹回忆",
    author: "霓虹小队",
    authorLevel: "FD5",
    cover: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&q=80",
    desc: "上海2089——一位记忆修复师发现自己的记忆遭到篡改。连载小说改编，已完成3集。",
    tags: ["科幻", "情感", "未来都市"],
    stage: "producing",
    episodes: 3,
    targetEpisodes: 10,
    progress: 35,
    valuation: 500000,
    sharesOffered: 25,
    sharesSold: 5,
    totalShares: 5,
    trailer: true,
    views: 23600,
    likes: 1820,
    featured: true,
    updatedAt: "2026-03-20",
  },
  {
    id: "ip4",
    title: "虚空传说",
    author: "虚空制作",
    authorLevel: "FD4",
    cover: "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=600&q=80",
    desc: "横跨十个平行宇宙的奇幻史诗，世界观设定超30万字。正在招募创作团队。",
    tags: ["奇幻", "史诗", "多元宇宙"],
    stage: "investment",
    valuation: 800000,
    sharesOffered: 30,
    pricePerShare: 80000,
    totalShares: 3,
    sharesSold: 1,
    trailer: false,
    episodes: 0,
    targetEpisodes: 10,
    views: 15300,
    likes: 1102,
    featured: true,
    updatedAt: "2026-03-18",
  },
  {
    id: "ip5",
    title: "算法女神",
    author: "数字缪斯",
    authorLevel: "FD3",
    cover: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=600&q=80",
    desc: "一个AI女性角色觉醒自我意识——动画短剧改编，预售解锁中。",
    tags: ["AI", "女性主义", "科技"],
    stage: "presale",
    presalePrice: 30,
    fullPrice: 100,
    presaleTarget: 100,
    presaleCurrent: 100,
    presaleDeadline: "2026-04-15",
    trailer: true,
    episodes: 0,
    targetEpisodes: 8,
    views: 9800,
    likes: 720,
    featured: false,
    updatedAt: "2026-03-25",
  },
  {
    id: "ip6",
    title: "末日幸存者日记",
    author: "末日工坊",
    authorLevel: "FD3",
    cover: "https://images.unsplash.com/photo-1545665277-5937489579f2?w=600&q=80",
    desc: "后启示录群像故事——全10集已完结，现已上线。",
    tags: ["后启示录", "生存", "人性"],
    stage: "released",
    episodes: 10,
    targetEpisodes: 10,
    watchPrice: 100,
    trailer: true,
    views: 32000,
    likes: 2480,
    featured: true,
    updatedAt: "2026-03-15",
  },
  {
    id: "ip7",
    title: "大唐奇谭",
    author: "长安工作室",
    authorLevel: "FD2",
    cover: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=600&q=80",
    desc: "以大唐为背景的玄幻漫画改编。预告片已完成，现接受投资认购。",
    tags: ["历史", "玄幻", "唐朝"],
    stage: "investment",
    valuation: 300000,
    sharesOffered: 40,
    pricePerShare: 60000,
    totalShares: 2,
    sharesSold: 0,
    trailer: true,
    episodes: 0,
    targetEpisodes: 6,
    views: 11500,
    likes: 869,
    featured: false,
    updatedAt: "2026-03-21",
  },
  {
    id: "ip8",
    title: "平行人生",
    author: "平行工作室",
    authorLevel: "FD4",
    cover: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=600&q=80",
    desc: "六个人身陷神秘的平行实验——每集切换视角，结局揭露真相。已完成5集，制作中。",
    tags: ["悬疑", "科幻", "心理"],
    stage: "producing",
    episodes: 5,
    targetEpisodes: 10,
    progress: 55,
    trailer: true,
    views: 18200,
    likes: 1340,
    featured: true,
    updatedAt: "2026-03-23",
  },
];

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
  certified: boolean;
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

// ─── Detail mock data ────────────────────────────────

export const MOCK_IP_DETAIL: IPDetail = {
  ...MOCK_IPS[0],
  stage: "released",
  tagline: "当上古神话遇见未来科技，一场跨越千年的赛博冒险即将开始",
  story: `2187年，新长安。这座矗立在昆仑山脚下的巨型城市，是人类最后的堡垒。一千年前，"大衍变"从数据洪流中唤醒了远古神兽——它们以量子态存在于赛博空间中，却能通过脑机接口入侵现实。

政府组建了"山海局"——一个汇集最精锐脑机猎手的秘密组织。主角罗清漪，一个在废墟区长大的女孩，意外发现自己能与远古神兽建立共鸣链接。当她被卷入山海局与神兽"穷奇"之间的致命博弈，一个关于人类起源和文明命运的惊天秘密开始缓缓揭开。

这不仅是一个关于战斗与冒险的故事，更是对"何为人、何为神、何为机器"的终极叩问。在霓虹闪烁的赛博街巷中，《山海经》的远古传说正以全新的方式重生。`,
  whyThisIP: `赛博朋克与东方神话的融合在全球市场几乎是未开发的领域。我们的核心优势包括：原创"量子神兽"世界观体系，已完成20万字设定文档；团队成员来自顶级动画工作室，拥有成熟的AI辅助制作流程。

我们的目标是打造跨媒体 IP 宇宙——从动画剧集延伸到漫画、游戏和周边，形成完整的内容生态。首支概念PV已实现百万级播放量，验证了市场需求。`,
  productionPlan: [
    {
      phase: "概念设计",
      timeline: "2025.08 - 2025.10",
      status: "completed",
      description: "完成世界观构建、角色设计和概念PV制作",
    },
    {
      phase: "剧本与分镜",
      timeline: "2025.10 - 2026.01",
      status: "completed",
      description: "10集完整剧本、关键分镜、配音选角",
    },
    {
      phase: "主体制作",
      timeline: "2026.01 - 2026.08",
      status: "completed",
      description: "每月制作1-2集，同步进行配音与音乐录制",
    },
    {
      phase: "后期与上映",
      timeline: "2026.08 - 2026.10",
      status: "completed",
      description: "全面精修，平台上线，宣传发行",
    },
  ],
  team: [
    {
      name: "影子",
      role: "制片人",
      avatar: "🎬",
      level: "FD4",
      projects: 12,
      rating: 4.9,
      certified: true,
    },
    {
      name: "银河",
      role: "编剧",
      avatar: "✍️",
      level: "FD3",
      projects: 8,
      rating: 4.7,
      certified: true,
    },
    {
      name: "像素",
      role: "美术",
      avatar: "🎨",
      level: "FD3",
      projects: 15,
      rating: 4.8,
      certified: true,
    },
    {
      name: "幽灵",
      role: "音乐",
      avatar: "🎵",
      level: "FD2",
      projects: 6,
      rating: 4.6,
      certified: false,
    },
  ],
  updates: [
    {
      date: "2026-03-20",
      title: "全集已上线",
      content: "《赛博山海经》全10集已正式上线。感谢所有支持者！",
    },
    {
      date: "2026-03-10",
      title: "第10集完成",
      content: "大结局「新纪元」已完成后期制作，即将上线。",
    },
    {
      date: "2026-02-28",
      title: "周边商店开放",
      content: "赛博山海经官方周边商店已开放，投资人享专属折扣。",
    },
  ],
  episodeList: [
    { number: 1, title: "新长安", price: 12, free: false },
    { number: 2, title: "山海局", price: 15, free: false },
    { number: 3, title: "霓虹追逐", price: 15, free: false },
    { number: 4, title: "穷奇之影", price: 15, free: false },
    { number: 5, title: "量子神兽", price: 18, free: false },
    { number: 6, title: "废墟之下", price: 15, free: false },
    { number: 7, title: "共鸣链接", price: 15, free: false },
    { number: 8, title: "大衍真相", price: 18, free: false },
    { number: 9, title: "昆仑之巅", price: 18, free: false },
    { number: 10, title: "新纪元", price: 11, free: false },
  ],
  bundlePrice: 100,
  singleTotal: 152,
  faqs: [
    {
      q: "全集包和单集购买有什么区别？",
      a: "全集包包含全部10集，总价100元，比逐集购买节省52元。单集购买可按需选择，但总价更高。",
    },
    {
      q: "购买后可以永久观看吗？",
      a: "是的，购买的内容永久保存在您的账户中，可随时重看。我们不会下架已购买的内容。",
    },
    {
      q: "如何成为投资人？",
      a: "本项目已完成投资阶段。您可以关注我们工作室的其他新项目，在投资阶段参与认购。",
    },
  ],
};
