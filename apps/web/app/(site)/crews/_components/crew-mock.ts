import type { Icon } from "@tabler/icons-react";
import {
  IconUserPlus,
  IconBriefcase,
  IconCircleCheck,
  IconUpload,
  IconMessageCircle,
  IconAward,
  IconMovie,
  IconAlertCircle,
} from "@tabler/icons-react";

// ─── Types ───────────────────────────────────────────

export interface CrewItem {
  id: string;
  name: string;
  ipName: string;
  projectType: string;
  status: "recruiting" | "in_production" | "post_production" | "completed";
  currentPhase: string;
  description: string;
  progress: number;
  memberCount: number;
  producerName: string;
  budgetRange: string;
  deadline: string;
  rolesNeeded: string[];
  coverImage: string;
}

export interface ActivityItem {
  id: number;
  icon: Icon;
  color: string;
  text: string;
  time: string;
}

// ─── Status config ───────────────────────────────────

export interface StatusStyle {
  labelKey: string;
  badge: string;
}

export const STATUS_CONFIG: Record<CrewItem["status"], StatusStyle> = {
  recruiting: {
    labelKey: "statusRecruiting",
    badge: "text-green-400 bg-green-400/10 border-green-400/30",
  },
  in_production: {
    labelKey: "statusInProduction",
    badge: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  },
  post_production: {
    labelKey: "statusPostProduction",
    badge: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  },
  completed: {
    labelKey: "statusCompleted",
    badge: "text-muted-foreground bg-muted/50 border-border",
  },
};

export const PHASE_DOT: Record<string, string> = {
  设计阶段: "bg-yellow-400",
  分镜阶段: "bg-blue-400",
  视频生成: "bg-cyan-400",
  配音配乐: "bg-purple-400",
  粗剪: "bg-orange-400",
  精剪: "bg-green-400",
  后期处理: "bg-pink-400",
  发行准备: "bg-red-400",
};

// ─── Filters ─────────────────────────────────────────

export const STATUS_TABS = [
  { value: "all", labelKey: "filterAll" },
  { value: "recruiting", labelKey: "statusRecruiting" },
  { value: "in_production", labelKey: "statusInProduction" },
  { value: "post_production", labelKey: "statusPostProduction" },
] as const;

export const ROLE_FILTERS = ["AI绘画", "分镜师", "配音", "后期剪辑", "音乐", "编剧"] as const;

// ─── Mock data ───────────────────────────────────────

export const MOCK_CREWS: CrewItem[] = [
  {
    id: "s1",
    name: "赛博山海经预告片组",
    ipName: "赛博山海经",
    projectType: "IP 开发",
    status: "recruiting",
    currentPhase: "分镜阶段",
    description: "角色设计和预告片制作中，正在招募分镜师和AI绘画师",
    progress: 35,
    memberCount: 6,
    producerName: "影子制片",
    budgetRange: "¥3k-8k",
    deadline: "2026-04-10",
    rolesNeeded: ["分镜师", "AI绘画", "配音", "后期"],
    coverImage: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=600&q=80",
  },
  {
    id: "s2",
    name: "深港品牌宣传片组",
    ipName: "深港纪事",
    projectType: "品牌片",
    status: "in_production",
    currentPhase: "视频生成",
    description: "初剪已完成，正在招募配音和后期调色师",
    progress: 62,
    memberCount: 9,
    producerName: "浪潮导演",
    budgetRange: "¥5k-12k",
    deadline: "2026-04-03",
    rolesNeeded: ["配音", "调色师", "混音"],
    coverImage: "https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=600&q=80",
  },
  {
    id: "s3",
    name: "霓虹回忆 MV 组",
    ipName: "霓虹回忆",
    projectType: "创意实验",
    status: "post_production",
    currentPhase: "精剪",
    description: "赛博朋克风格 MV，主体拍摄完成，正在招募精剪师",
    progress: 78,
    memberCount: 5,
    producerName: "霓虹小队",
    budgetRange: "¥2k-5k",
    deadline: "2026-03-30",
    rolesNeeded: ["精剪师", "字幕"],
    coverImage: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&q=80",
  },
  {
    id: "s4",
    name: "虚空传说10集动画",
    ipName: "虚空传说",
    projectType: "系列剧",
    status: "recruiting",
    currentPhase: "设计阶段",
    description: "10集AI动画，正在组建核心创作团队",
    progress: 15,
    memberCount: 3,
    producerName: "虚空制作",
    budgetRange: "¥8k-20k",
    deadline: "2026-05-15",
    rolesNeeded: ["编剧", "角色设计", "分镜师", "AI绘画", "副导演"],
    coverImage: "https://images.unsplash.com/photo-1534796636912-3b95b3ab5986?w=600&q=80",
  },
  {
    id: "s5",
    name: "算法女神商业宣传片",
    ipName: "算法女神",
    projectType: "商业项目",
    status: "in_production",
    currentPhase: "配音配乐",
    description: "AI美学宣传片，主体视频已完成，招募配音和原创音乐制作人",
    progress: 55,
    memberCount: 7,
    producerName: "数字缪斯",
    budgetRange: "¥6k-15k",
    deadline: "2026-04-07",
    rolesNeeded: ["配音", "音乐制作人"],
    coverImage: "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=600&q=80",
  },
  {
    id: "s6",
    name: "末日幸存者先导片",
    ipName: "末日幸存者",
    projectType: "IP 开发",
    status: "recruiting",
    currentPhase: "粗剪",
    description: "后启示录AI先导片，招募剪辑师完成第一集",
    progress: 48,
    memberCount: 8,
    producerName: "末日工坊",
    budgetRange: "¥4k-10k",
    deadline: "2026-04-20",
    rolesNeeded: ["剪辑师", "字幕", "后期"],
    coverImage: "https://images.unsplash.com/photo-1545665277-5937489579f2?w=600&q=80",
  },
];

export const PLATFORM_STATS = [
  { labelKey: "statStudios", value: "128" },
  { labelKey: "statRoles", value: "340+" },
  { labelKey: "statCreators", value: "2.4k" },
  { labelKey: "statCompleted", value: "89" },
];

export const MOCK_ACTIVITIES: ActivityItem[] = [
  {
    id: 1,
    icon: IconUserPlus,
    color: "text-green-400 bg-green-400/10",
    text: "Ghost制片 加入了「深港纪事」剧组",
    time: "10分钟前",
  },
  {
    id: 2,
    icon: IconBriefcase,
    color: "text-blue-400 bg-blue-400/10",
    text: "「深港纪事」新增职位：场景概念师",
    time: "30分钟前",
  },
  {
    id: 3,
    icon: IconCircleCheck,
    color: "text-cyan-400 bg-cyan-400/10",
    text: "齿轮画师 完成了「机械臂设计」任务",
    time: "1小时前",
  },
  {
    id: 4,
    icon: IconUpload,
    color: "text-purple-400 bg-purple-400/10",
    text: "星轨编剧 上传了 EP03 剧本终稿",
    time: "2小时前",
  },
  {
    id: 5,
    icon: IconMessageCircle,
    color: "text-amber-400 bg-amber-400/10",
    text: "浪潮导演 评论了「角色配色方案」",
    time: "3小时前",
  },
  {
    id: 6,
    icon: IconAward,
    color: "text-yellow-400 bg-yellow-400/10",
    text: "调色大师 获得了「多产画师」徽章",
    time: "4小时前",
  },
  {
    id: 7,
    icon: IconMovie,
    color: "text-red-400 bg-red-400/10",
    text: "「蒸汽纪元」EP02 进入后期制作",
    time: "5小时前",
  },
  {
    id: 8,
    icon: IconAlertCircle,
    color: "text-orange-400 bg-orange-400/10",
    text: "「赛博朋克2099」分镜任务即将到期",
    time: "6小时前",
  },
];

// ─── Detail types ────────────────────────────────────

export interface CrewPhase {
  name: string;
  done: boolean;
  active?: boolean;
}

export interface CrewRole {
  name: string;
  count: number;
  budget: string;
  period: string;
  deadline: string;
  skills: string[];
  deliverable: string;
}

export interface CrewMember {
  name: string;
  role: string;
  level: string;
}

export interface CrewDetail extends CrewItem {
  fullDescription: string;
  phases: CrewPhase[];
  roles: CrewRole[];
  members: CrewMember[];
  activities: { text: string; time: string }[];
}

export const MOCK_CREW_DETAIL: CrewDetail = {
  ...MOCK_CREWS[0],
  fullDescription:
    "赛博山海经是一部融合中国传统神话与赛博朋克美学的AI动画短剧。预告片组负责制作一段2分钟的宣传预告片，展示世界观和核心角色。目前角色设计已完成70%，分镜正在进行中，下一阶段将启动AI视频生成和配音录制。",
  phases: [
    { name: "世界观构建", done: true },
    { name: "角色设计", done: true },
    { name: "场景设计", done: true },
    { name: "分镜制作", done: false, active: true },
    { name: "视频生成", done: false },
    { name: "配音配乐", done: false },
    { name: "粗剪", done: false },
    { name: "精剪与发行", done: false },
  ],
  roles: [
    {
      name: "分镜师",
      count: 1,
      budget: "¥1500-3000",
      period: "2周",
      deadline: "2026-04-01",
      skills: ["分镜绘制", "镜头语言", "叙事节奏"],
      deliverable: "60格分镜草稿 + 标注说明",
    },
    {
      name: "AI画师",
      count: 2,
      budget: "¥2000-4000",
      period: "3周",
      deadline: "2026-04-05",
      skills: ["Midjourney", "Stable Diffusion", "角色设计"],
      deliverable: "精修角色图 ×10 套 + Prompt 包",
    },
    {
      name: "配音演员",
      count: 3,
      budget: "¥500-1500/角色",
      period: "1周",
      deadline: "2026-04-08",
      skills: ["专业配音", "录音设备"],
      deliverable: "WAV 录音文件 + 备份版本",
    },
    {
      name: "后期剪辑",
      count: 1,
      budget: "¥2000-3500",
      period: "2周",
      deadline: "2026-04-10",
      skills: ["Premiere", "After Effects", "DaVinci"],
      deliverable: "精剪母版 + 字幕版",
    },
  ],
  members: [
    { name: "影子制片", role: "制片人", level: "FD4" },
    { name: "夜色导演", role: "导演", level: "FD3" },
    { name: "银河编剧", role: "编剧", level: "FD3" },
    { name: "像素画师", role: "AI绘画", level: "FD2" },
    { name: "光影设计", role: "场景设计", level: "FD3" },
    { name: "Ghost制片", role: "副制片", level: "FD2" },
  ],
  activities: [
    { text: "Ghost制片 加入剧组担任副制片", time: "3小时前" },
    { text: "场景设计阶段完成，进入分镜制作", time: "1天前" },
    { text: "新增「AI画师」职位 ×2", time: "2天前" },
    { text: "像素画师 提交了第一批角色参考图", time: "3天前" },
  ],
};
