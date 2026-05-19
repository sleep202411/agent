/**
 * Demo crew fillers for the Plaza.
 *
 * Pure front-end fixtures — NEVER hit the backend. The Plaza
 * appends these after real crews so the grid doesn't look anemic
 * during early adoption. Clicking a demo card lands on the same
 * `/crews/[id]` detail page; the data hooks (useCrewDetail,
 * useCrewPositions, useCrewMembers) short-circuit on `isDemoId(id)`
 * and return the demo data below instead of calling the backend.
 *
 * To retire demo fillers when real supply ramps up: empty the
 * `DEMO_CREWS` array (or wrap the import in a
 * `NEXT_PUBLIC_SHOW_DEMO_CREWS` env gate). The hook short-circuits
 * become no-ops automatically since no id will match the prefix.
 */

import type { CrewDTO, CrewMemberDTO, CrewPositionDTO } from "@/app/(site)/crews/_hooks/use-crew";

export interface DemoCrewDTO extends CrewDTO {
  isDemo: true;
}

/** Wide (16:9) crop — used for showcaseWorks thumbnails. */
const UNSPLASH = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1600&q=80`;
/** Square (1:1) crop — used for crew logos. Smaller fetch since
 *  logos render at 32-96px max in any UI surface. */
const UNSPLASH_SQ = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=400&h=400&q=80`;

const FOUNDED = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

// ─── Demo positions & members per crew ────────────────────

interface DemoPositionInit {
  /** A short suffix to make ids stable across renders (e.g. "001-a"). */
  suffix: string;
  positionType: CrewPositionDTO["positionType"];
  description: string;
  targetCount: number;
  recruitedCount: number;
  status: CrewPositionDTO["status"];
  workMode: CrewPositionDTO["workMode"];
  location?: string;
  employmentType: CrewPositionDTO["employmentType"];
  experienceLevel: CrewPositionDTO["experienceLevel"];
  requiredSkills: string[];
  salary?: {
    period: NonNullable<CrewPositionDTO["salary"]["period"]>;
    currency: NonNullable<CrewPositionDTO["salary"]["currency"]>;
    minAmount: number;
    maxAmount: number;
  };
  closeDate?: string;
  ageDays: number;
}

interface DemoMemberInit {
  suffix: string;
  userId: string;
  roleType: string;
  via: CrewMemberDTO["via"];
  isFinance?: boolean;
  joinedDaysAgo: number;
}

interface DemoCrewInit {
  id: string;
  name: string;
  description: string;
  logo: string;
  tagline: string;
  genres: CrewDTO["genres"];
  styles: CrewDTO["styles"];
  showcaseWorks: NonNullable<CrewDTO["showcaseWorks"]>;
  founderId: string;
  createdDaysAgo: number;
  updatedDaysAgo: number;
  members: DemoMemberInit[];
  positions: DemoPositionInit[];
}

const RAW_CREWS: DemoCrewInit[] = [
  {
    id: "demo-crew-001",
    name: "暗夜星河 Studio",
    description:
      "聚焦科幻动画长篇的独立制作组。冷色调、慢节奏,关注真实科学想象与人性张力的交叉地带。已上线 2 部短片,12 集长篇筹备中。",
    logo: UNSPLASH_SQ("photo-1502134249126-9f3755a50d78"),
    tagline: "让每个深夜的故事都被看见",
    genres: ["animation", "experimental"],
    styles: ["2d"],
    showcaseWorks: [
      {
        thumbnailUrl: UNSPLASH("photo-1500917293891-ef795e70e1f6"),
        title: "深空回声 · 第 1 集",
        externalUrl: null,
        viewCount: 124300,
      },
    ],
    founderId: "demo-founder-001",
    createdDaysAgo: 180,
    updatedDaysAgo: 2,
    members: [
      {
        suffix: "m1",
        userId: "demo-founder-001",
        roleType: "owner",
        via: "founder",
        joinedDaysAgo: 180,
      },
      {
        suffix: "m2",
        userId: "demo-001-002",
        roleType: "screenwriter",
        via: "manual",
        joinedDaysAgo: 160,
      },
      {
        suffix: "m3",
        userId: "demo-001-003",
        roleType: "storyboard",
        via: "manual",
        joinedDaysAgo: 90,
      },
      {
        suffix: "m4",
        userId: "demo-001-004",
        roleType: "animator",
        via: "manual",
        joinedDaysAgo: 45,
      },
      {
        suffix: "m5",
        userId: "demo-001-005",
        roleType: "music_composer",
        via: "application",
        isFinance: true,
        joinedDaysAgo: 30,
      },
    ],
    positions: [
      {
        suffix: "p1",
        positionType: "voice_actor",
        description:
          "为 12 集科幻动画中的女主角(35 岁,冷峻、克制)配音,需要驾驭情感张力大的独白段落。",
        targetCount: 1,
        recruitedCount: 0,
        status: "full",
        workMode: "remote",
        employmentType: "project_based",
        experienceLevel: "senior",
        requiredSkills: ["情感张力", "英语流利", "科幻题材经验"],
        salary: { period: "project", currency: "CNY", minAmount: 800000, maxAmount: 1500000 },
        ageDays: 7,
      },
      {
        suffix: "p2",
        positionType: "sound_designer",
        description: "负责整片环境音、UI 音效设计与混音。预算 6 个月,可接长期合作。",
        targetCount: 1,
        recruitedCount: 0,
        status: "full",
        workMode: "hybrid",
        location: "北京",
        employmentType: "contract",
        experienceLevel: "mid",
        requiredSkills: ["Pro Tools", "环境音设计", "5.1 混音"],
        ageDays: 3,
      },
    ],
  },
  {
    id: "demo-crew-002",
    name: "市井三千",
    description:
      "城市纪录短剧团队。走街串巷把市井人物的故事拍成 5-8 分钟短片。三年累计 36 集,小红书 12 万粉。",
    logo: UNSPLASH_SQ("photo-1518709268805-4e9042af9f23"),
    tagline: "三千街巷,三千个人",
    genres: ["documentary", "shortform"],
    styles: ["live_action"],
    showcaseWorks: [
      {
        thumbnailUrl: UNSPLASH("photo-1478720568477-152d9b164e26"),
        title: "凌晨四点的早餐摊",
        externalUrl: null,
        viewCount: 87000,
      },
    ],
    founderId: "demo-founder-002",
    createdDaysAgo: 420,
    updatedDaysAgo: 5,
    members: [
      {
        suffix: "m1",
        userId: "demo-founder-002",
        roleType: "owner",
        via: "founder",
        joinedDaysAgo: 420,
      },
      {
        suffix: "m2",
        userId: "demo-002-002",
        roleType: "producer",
        via: "manual",
        isFinance: true,
        joinedDaysAgo: 400,
      },
      {
        suffix: "m3",
        userId: "demo-002-003",
        roleType: "editor",
        via: "application",
        joinedDaysAgo: 120,
      },
      {
        suffix: "m4",
        userId: "demo-002-004",
        roleType: "screenwriter",
        via: "manual",
        joinedDaysAgo: 60,
      },
    ],
    positions: [
      {
        suffix: "p1",
        positionType: "screenwriter",
        description: "为纪录短剧梳理人物弧光与采访结构,要求对一线生活有真实感知,能跟拍现场速记。",
        targetCount: 2,
        recruitedCount: 0,
        status: "full",
        workMode: "onsite",
        location: "上海",
        employmentType: "part_time",
        experienceLevel: "mid",
        requiredSkills: ["采访", "纪录片叙事", "Final Draft"],
        salary: { period: "episode", currency: "CNY", minAmount: 300000, maxAmount: 500000 },
        ageDays: 14,
      },
    ],
  },
  {
    id: "demo-crew-003",
    name: "春日狂想曲",
    description: "治愈系 2D 动画工作室。吉卜力 + 新海诚风格,色彩柔和。今年计划做 6 集季播番。",
    logo: UNSPLASH_SQ("photo-1547954575-855750c57bd3"),
    tagline: "把柔软留给世界",
    genres: ["animation"],
    styles: ["2d"],
    showcaseWorks: [
      {
        thumbnailUrl: UNSPLASH("photo-1535016120720-40c646be5580"),
        title: "在风里折一只纸船",
        externalUrl: null,
        viewCount: 230000,
      },
    ],
    founderId: "demo-founder-003",
    createdDaysAgo: 95,
    updatedDaysAgo: 1,
    members: [
      {
        suffix: "m1",
        userId: "demo-founder-003",
        roleType: "owner",
        via: "founder",
        joinedDaysAgo: 95,
      },
      {
        suffix: "m2",
        userId: "demo-003-002",
        roleType: "director",
        via: "manual",
        joinedDaysAgo: 90,
      },
      {
        suffix: "m3",
        userId: "demo-003-003",
        roleType: "background_design",
        via: "manual",
        joinedDaysAgo: 70,
      },
      {
        suffix: "m4",
        userId: "demo-003-004",
        roleType: "animator",
        via: "application",
        joinedDaysAgo: 45,
      },
      {
        suffix: "m5",
        userId: "demo-003-005",
        roleType: "animator",
        via: "application",
        joinedDaysAgo: 30,
      },
      {
        suffix: "m6",
        userId: "demo-003-006",
        roleType: "editor",
        via: "manual",
        isFinance: true,
        joinedDaysAgo: 20,
      },
    ],
    positions: [
      {
        suffix: "p1",
        positionType: "animator",
        description: "2D 原画岗位。要求会动作流程、有情感戏经验。每集约 200 张原画。",
        targetCount: 3,
        recruitedCount: 1,
        status: "full",
        workMode: "remote",
        employmentType: "project_based",
        experienceLevel: "mid",
        requiredSkills: ["CSP", "动作流程", "情感戏"],
        salary: { period: "month", currency: "CNY", minAmount: 1200000, maxAmount: 2000000 },
        ageDays: 5,
      },
      {
        suffix: "p2",
        positionType: "background_design",
        description: "负责日系风格场景设计与背景绘制,色彩偏柔和、暖色调为主。",
        targetCount: 1,
        recruitedCount: 1,
        status: "full",
        workMode: "remote",
        employmentType: "freelance",
        experienceLevel: "senior",
        requiredSkills: ["Photoshop", "色彩理论", "日系画风"],
        ageDays: 60,
      },
    ],
  },
  {
    id: "demo-crew-004",
    name: "黑潮少年",
    description:
      "热血少年漫工作室。改编原创 IP《黑潮》成 24 集动画。预算充足、节奏快、追求高燃画面。",
    logo: UNSPLASH_SQ("photo-1493238792000-8113da705763"),
    tagline: "燃到血脉偾张才算完",
    genres: ["animation"],
    styles: ["2d", "mixed_media"],
    showcaseWorks: [
      {
        thumbnailUrl: UNSPLASH("photo-1518929458119-e5bf444c30f4"),
        title: "黑潮 · PV",
        externalUrl: null,
        viewCount: 1840000,
      },
    ],
    founderId: "demo-founder-004",
    createdDaysAgo: 260,
    updatedDaysAgo: 0,
    members: [
      {
        suffix: "m1",
        userId: "demo-founder-004",
        roleType: "owner",
        via: "founder",
        joinedDaysAgo: 260,
      },
      {
        suffix: "m2",
        userId: "demo-004-002",
        roleType: "director",
        via: "manual",
        joinedDaysAgo: 240,
      },
      {
        suffix: "m3",
        userId: "demo-004-003",
        roleType: "screenwriter",
        via: "manual",
        joinedDaysAgo: 200,
      },
      {
        suffix: "m4",
        userId: "demo-004-004",
        roleType: "storyboard",
        via: "application",
        joinedDaysAgo: 90,
      },
      {
        suffix: "m5",
        userId: "demo-004-005",
        roleType: "music_composer",
        via: "manual",
        joinedDaysAgo: 80,
      },
      {
        suffix: "m6",
        userId: "demo-004-006",
        roleType: "editor",
        via: "application",
        isFinance: true,
        joinedDaysAgo: 40,
      },
      {
        suffix: "m7",
        userId: "demo-004-007",
        roleType: "marketing",
        via: "manual",
        joinedDaysAgo: 10,
      },
    ],
    positions: [
      {
        suffix: "p1",
        positionType: "storyboard",
        description: "24 集热血动作番剧分镜师。每集约 350 个镜头,节奏快、战斗戏多。",
        targetCount: 2,
        recruitedCount: 1,
        status: "full",
        workMode: "hybrid",
        location: "杭州",
        employmentType: "full_time",
        experienceLevel: "senior",
        requiredSkills: ["动作戏分镜", "电影感构图", "快节奏剪辑"],
        salary: { period: "month", currency: "CNY", minAmount: 2000000, maxAmount: 3500000 },
        ageDays: 2,
      },
      {
        suffix: "p2",
        positionType: "animator",
        description: "负责战斗戏关键帧与中间帧。需有 3 部以上完整作品经验。",
        targetCount: 4,
        recruitedCount: 2,
        status: "full",
        workMode: "onsite",
        location: "杭州",
        employmentType: "full_time",
        experienceLevel: "mid",
        requiredSkills: ["战斗戏", "CSP", "After Effects"],
        ageDays: 1,
      },
    ],
  },
  {
    id: "demo-crew-005",
    name: "回音山谷",
    description: "聚焦中国西南少数民族文化的纪录片小组。每年 2 部长片,与当地非遗传承人合作。",
    logo: UNSPLASH_SQ("photo-1464822759023-fed622ff2c3b"),
    tagline: "听山的另一面",
    genres: ["documentary"],
    styles: ["documentary"],
    showcaseWorks: [
      {
        thumbnailUrl: UNSPLASH("photo-1502139214982-d0ad755818d8"),
        title: "侗族大歌 · 寨子里的合唱",
        externalUrl: null,
        viewCount: 45200,
      },
    ],
    founderId: "demo-founder-005",
    createdDaysAgo: 540,
    updatedDaysAgo: 14,
    members: [
      {
        suffix: "m1",
        userId: "demo-founder-005",
        roleType: "owner",
        via: "founder",
        joinedDaysAgo: 540,
      },
      {
        suffix: "m2",
        userId: "demo-005-002",
        roleType: "producer",
        via: "manual",
        isFinance: true,
        joinedDaysAgo: 500,
      },
      {
        suffix: "m3",
        userId: "demo-005-003",
        roleType: "editor",
        via: "manual",
        joinedDaysAgo: 300,
      },
    ],
    positions: [],
  },
  {
    id: "demo-crew-006",
    name: "赛博沙俏",
    description:
      "赛博朋克风格商业广告与 MV 制作组。服务快销品牌、电竞战队、独立音乐人。出片快、视觉冲击强。",
    logo: UNSPLASH_SQ("photo-1505740420928-5e560c06d30e"),
    tagline: "让品牌穿上未来",
    genres: ["mv", "commercial"],
    styles: ["3d", "mixed_media"],
    showcaseWorks: [
      {
        thumbnailUrl: UNSPLASH("photo-1492684223066-81342ee5ff30"),
        title: "霓虹三章 · 电竞战队 BP",
        externalUrl: null,
        viewCount: 320000,
      },
    ],
    founderId: "demo-founder-006",
    createdDaysAgo: 140,
    updatedDaysAgo: 3,
    members: [
      {
        suffix: "m1",
        userId: "demo-founder-006",
        roleType: "owner",
        via: "founder",
        joinedDaysAgo: 140,
      },
      {
        suffix: "m2",
        userId: "demo-006-002",
        roleType: "character_design",
        via: "manual",
        joinedDaysAgo: 120,
      },
      {
        suffix: "m3",
        userId: "demo-006-003",
        roleType: "compositor",
        via: "application",
        joinedDaysAgo: 80,
      },
      {
        suffix: "m4",
        userId: "demo-006-004",
        roleType: "sound_designer",
        via: "application",
        joinedDaysAgo: 60,
      },
      {
        suffix: "m5",
        userId: "demo-006-005",
        roleType: "marketing",
        via: "manual",
        isFinance: true,
        joinedDaysAgo: 20,
      },
    ],
    positions: [
      {
        suffix: "p1",
        positionType: "compositor",
        description: "负责后期合成与特效。需熟悉 Nuke / After Effects,3 年以上 MV/广告经验。",
        targetCount: 2,
        recruitedCount: 0,
        status: "full",
        workMode: "remote",
        employmentType: "freelance",
        experienceLevel: "mid",
        requiredSkills: ["Nuke", "After Effects", "3D 合成"],
        salary: { period: "project", currency: "CNY", minAmount: 1500000, maxAmount: 2500000 },
        ageDays: 6,
      },
    ],
  },
  {
    id: "demo-crew-007",
    name: "影像档案室",
    description:
      "实验影像团队。介于纪录、装置、实验短片之间的内容,作品在国内外艺术节展出。非营利为主。",
    logo: UNSPLASH_SQ("photo-1606889464198-fcb18894cf50"),
    tagline: "把日常变成档案",
    genres: ["experimental", "documentary"],
    styles: ["mixed_media"],
    showcaseWorks: [
      {
        thumbnailUrl: UNSPLASH("photo-1574267432553-4b4628081c31"),
        title: "片场 · 8 分钟实验剪辑",
        externalUrl: null,
        viewCount: 8400,
      },
    ],
    founderId: "demo-founder-007",
    createdDaysAgo: 720,
    updatedDaysAgo: 30,
    members: [
      {
        suffix: "m1",
        userId: "demo-founder-007",
        roleType: "owner",
        via: "founder",
        joinedDaysAgo: 720,
      },
      {
        suffix: "m2",
        userId: "demo-007-002",
        roleType: "editor",
        via: "manual",
        joinedDaysAgo: 600,
      },
      {
        suffix: "m3",
        userId: "demo-007-003",
        roleType: "sound_designer",
        via: "manual",
        joinedDaysAgo: 400,
      },
    ],
    positions: [],
  },
  {
    id: "demo-crew-008",
    name: "薄雾计划",
    description:
      "探索 AI 与人类创作者协作的实验剧团。一半镜头由 AI 生成,人类做选片、再创作和情感调校。每月 1 集,公开制作日志。",
    logo: UNSPLASH_SQ("photo-1620712943543-bcc4688e7485"),
    tagline: "AI 是新一种合作者",
    genres: ["experimental", "shortform"],
    styles: ["ai_assisted"],
    showcaseWorks: [
      {
        thumbnailUrl: UNSPLASH("photo-1485846234645-a62644f84728"),
        title: "薄雾 · 第 1 集",
        externalUrl: null,
        viewCount: 56800,
      },
    ],
    founderId: "demo-founder-008",
    createdDaysAgo: 60,
    updatedDaysAgo: 1,
    members: [
      {
        suffix: "m1",
        userId: "demo-founder-008",
        roleType: "owner",
        via: "founder",
        joinedDaysAgo: 60,
      },
      {
        suffix: "m2",
        userId: "demo-008-002",
        roleType: "screenwriter",
        via: "manual",
        joinedDaysAgo: 50,
      },
      {
        suffix: "m3",
        userId: "demo-008-003",
        roleType: "compositor",
        via: "application",
        joinedDaysAgo: 40,
      },
      {
        suffix: "m4",
        userId: "demo-008-004",
        roleType: "editor",
        via: "manual",
        isFinance: true,
        joinedDaysAgo: 20,
      },
    ],
    positions: [
      {
        suffix: "p1",
        positionType: "character_design",
        description: "AI 生成角色的二次校对与统一化,要求理解 prompt 工程与传统角色设计。",
        targetCount: 2,
        recruitedCount: 0,
        status: "full",
        workMode: "remote",
        employmentType: "project_based",
        experienceLevel: "mid",
        requiredSkills: ["Stable Diffusion", "ComfyUI", "角色一致性"],
        salary: { period: "month", currency: "CNY", minAmount: 1500000, maxAmount: 2500000 },
        ageDays: 4,
      },
      {
        suffix: "p2",
        positionType: "producer",
        description: "统筹每月剧集制作 + AI 工作流优化。需有制片经验与 AI 工具实操经验。",
        targetCount: 1,
        recruitedCount: 0,
        status: "full",
        workMode: "hybrid",
        location: "深圳",
        employmentType: "contract",
        experienceLevel: "senior",
        requiredSkills: ["制片", "AI 工作流", "排期管理"],
        salary: { period: "month", currency: "CNY", minAmount: 2500000, maxAmount: 4000000 },
        ageDays: 10,
      },
    ],
  },
];

// ─── Builder: turn the compact RAW_CREWS into full DTOs ────

function buildPosition(crewId: string, p: DemoPositionInit): CrewPositionDTO {
  // Demo policy: every position renders as "filled" so the visitor
  // page's Apply CTA naturally disables to "已招满" without any
  // demo-specific code path. Source `recruitedCount` / `status` are
  // ignored at this layer; canonical filled state is recruitedCount=
  // targetCount + status="full". The plaza card's "招募" preview
  // still uses the source intent (see openPositionPreview above).
  return {
    id: `${crewId}-${p.suffix}`,
    crewId,
    positionType: p.positionType,
    description: p.description,
    targetCount: p.targetCount,
    recruitedCount: p.targetCount,
    status: "full",
    workMode: p.workMode,
    location: p.location ?? null,
    employmentType: p.employmentType,
    experienceLevel: p.experienceLevel,
    requiredSkills: p.requiredSkills,
    salary: {
      period: p.salary?.period ?? null,
      currency: p.salary?.currency ?? null,
      minAmount: p.salary?.minAmount ?? null,
      maxAmount: p.salary?.maxAmount ?? null,
      negotiable: !p.salary,
    },
    closeDate: p.closeDate ?? null,
    createdAt: new Date(Date.now() - p.ageDays * 86_400_000).toISOString(),
  };
}

function buildMember(crewId: string, m: DemoMemberInit): CrewMemberDTO {
  return {
    id: `${crewId}-${m.suffix}`,
    crewId,
    userId: m.userId,
    roleType: m.roleType,
    positionId: null,
    via: m.via,
    isFinance: m.isFinance ?? false,
    joinedAt: new Date(Date.now() - m.joinedDaysAgo * 86_400_000).toISOString(),
  };
}

const POSITIONS_BY_CREW: Record<string, CrewPositionDTO[]> = {};
const MEMBERS_BY_CREW: Record<string, CrewMemberDTO[]> = {};

export const DEMO_CREWS: DemoCrewDTO[] = RAW_CREWS.map((raw) => {
  const positions = raw.positions.map((p) => buildPosition(raw.id, p));
  const members = raw.members.map((m) => buildMember(raw.id, m));
  POSITIONS_BY_CREW[raw.id] = positions;
  MEMBERS_BY_CREW[raw.id] = members;

  // Demo-data policy: all positions are forced to `status: "full"` so
  // the visitor "Apply" CTA naturally disables. That makes
  // openPositionCount 0 everywhere — but for the plaza CARD we want
  // to surface what the crew was actively hiring for (otherwise the
  // showcase is the only signal). Use the RAW init's `status: "open"`
  // intent for preview names, not the post-build state.
  const previewNames = raw.positions
    .filter((p) => p.status === "open")
    .slice(0, 3)
    .map((p) => p.positionType);

  return {
    isDemo: true,
    id: raw.id,
    name: raw.name,
    description: raw.description,
    logo: raw.logo,
    tagline: raw.tagline,
    genres: raw.genres,
    styles: raw.styles,
    socialLinks: [],
    showcaseWorks: raw.showcaseWorks,
    founderId: raw.founderId,
    createdAt: FOUNDED(raw.createdDaysAgo),
    updatedAt: FOUNDED(raw.updatedDaysAgo),
    memberCount: members.length,
    openPositionCount: positions.filter((p) => p.status === "open").length,
    openPositionPreview: previewNames,
  };
});

const CREWS_BY_ID = new Map(DEMO_CREWS.map((c) => [c.id, c]));

// ─── Public helpers consumed by the data hooks ─────────────

const DEMO_PREFIX = "demo-crew-";

/** Cheap prefix check so query hooks can short-circuit before the
 *  actual fetch. */
export function isDemoCrewId(id: string | undefined | null): boolean {
  return !!id && id.startsWith(DEMO_PREFIX);
}

/** Return the full demo crew DTO, or null when the id isn't a known
 *  demo crew (treated as 404 by the hook). */
export function getDemoCrew(id: string): DemoCrewDTO | null {
  return CREWS_BY_ID.get(id) ?? null;
}

export function getDemoPositions(crewId: string): CrewPositionDTO[] {
  return POSITIONS_BY_CREW[crewId] ?? [];
}

export function getDemoMembers(crewId: string): CrewMemberDTO[] {
  return MEMBERS_BY_CREW[crewId] ?? [];
}

/** Crew identity slice attached to each row in the cross-crew
 *  positions view. Lets the card render "from which crew" without
 *  another lookup. Real backend will return this shape from
 *  `GET /aurora/positions` (join crew on the server). */
export interface PositionWithCrew {
  position: CrewPositionDTO;
  crew: Pick<CrewDTO, "id" | "name" | "logo" | "tagline" | "genres" | "styles">;
}

/** Flatten all demo crews' positions into one cross-crew list with
 *  enough crew context for the positions tab to render cards. */
export function getAllDemoPositionsWithCrew(): PositionWithCrew[] {
  const out: PositionWithCrew[] = [];
  for (const crew of DEMO_CREWS) {
    const positions = POSITIONS_BY_CREW[crew.id] ?? [];
    for (const position of positions) {
      out.push({
        position,
        crew: {
          id: crew.id,
          name: crew.name,
          logo: crew.logo,
          tagline: crew.tagline,
          genres: crew.genres,
          styles: crew.styles,
        },
      });
    }
  }
  return out;
}

/** Type guard used by the plaza card to swap to the demo variant. */
export function isDemoCrew(c: CrewDTO | DemoCrewDTO): c is DemoCrewDTO {
  return (c as DemoCrewDTO).isDemo === true;
}
