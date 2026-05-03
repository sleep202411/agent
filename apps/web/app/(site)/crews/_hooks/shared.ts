/**
 * Crews feature data layer — shared helpers + cache keys + mock datasets.
 *
 * Mirrors the IP feature's `_hooks/` split (see `app/(site)/ips/_hooks/`):
 * routes import only from `_hooks/use-crew` (re-export shim) or sibling
 * `_data` / `_components/`, never from `src/hooks/*`.
 *
 * ## Backend status
 *
 * The crew backend isn't ready yet. Every fetcher in this folder is
 * **mock-backed** — it imports the existing mock data under
 * `_components/{crew,workspace}-mock.ts` (and inlines a few extra
 * datasets here for applicants / applications / open jobs) and returns
 * it after a small delay so React Query's loading states behave
 * realistically. When endpoints come online, only the bodies of the
 * fetcher functions change. Hook signatures, types, and cache keys stay
 * put, so consuming pages keep working unchanged.
 *
 * ## Endpoint map (target)
 *
 *   POST /project/myprojects        → fetchMyOwnedCrews
 *   POST /project/myjoined          → fetchMyJoinedCrews
 *   POST /project/list              → searchCrews        (legacy: 广场列表)
 *   POST /project/query             → fetchCrewDetail
 *   POST /project/create            → createCrew
 *   POST /project/update            → updateCrew
 *   POST /project/delete            → deleteCrew
 *   POST /project/member/query      → fetchCrewMembers
 *   POST /project/member/invite     → inviteMember
 *   POST /project/member/remove     → removeMember
 *   POST /project/job/project/list  → fetchCrewJobs
 *   POST /project/job/find/jobs     → searchOpenJobs     (legacy: joinCrew)
 *   POST /project/job/create        → createJob
 *   POST /project/job/update        → updateJob
 *   POST /project/job/delete        → deleteJob
 *   POST /project/job/close         → closeJob
 *   POST /project/job/apply         → applyToJob
 *   POST /project/job/hasApply      → hasAppliedToJob
 *   POST /project/job/myapply       → fetchMyApplications
 *   POST /project/job/applicant     → fetchJobApplicants
 *   POST /project/job/aggree        → agreeApplicant
 *   POST /project/job/refuse        → rejectApplicant
 */

import { MOCK_CREWS } from "../_components/crew-mock";
import type { EpMemberStatus, JobApplicant, JobApplication } from "./types";

// ─── Query keys ────────────────────────────────────────

export interface CrewListFilter {
  search?: string;
  status?: string;
  role?: string;
}

export const crewKeys = {
  all: ["crew"] as const,
  list: (filter: CrewListFilter) => ["crew", "list", filter] as const,
  myOwned: ["crew", "mine", "owned"] as const,
  myJoined: ["crew", "mine", "joined"] as const,
  detail: (id: string) => ["crew", "detail", id] as const,
  workspace: (id: string) => ["crew", "workspace", id] as const,
  openJobs: (filter: { roleName?: string }) => ["crew", "openJobs", filter] as const,
  myApplications: ["crew", "applications", "mine"] as const,
  hasApplied: (jobId: number) => ["crew", "applications", "hasApplied", jobId] as const,
  applicants: (jobId: number) => ["crew", "applicants", jobId] as const,
  landing: ["crew", "landing"] as const,
  producerOverview: ["crew", "producer", "overview"] as const,
};

// ─── Mock helpers ──────────────────────────────────────

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── Mock-only datasets ────────────────────────────────

export const MOCK_OPEN_JOBS = [
  {
    id: 1001,
    crewId: "s1",
    crewName: "赛博山海经预告片组",
    crewCover: MOCK_CREWS[0].coverImage,
    roleName: "分镜师",
    budget: "¥1500-3000",
    period: "2 weeks",
    deadline: "2026-04-01",
    skills: ["分镜绘制", "镜头语言"],
    postedAt: "2026-04-23",
  },
  {
    id: 1002,
    crewId: "s1",
    crewName: "赛博山海经预告片组",
    crewCover: MOCK_CREWS[0].coverImage,
    roleName: "AI画师",
    budget: "¥2000-4000",
    period: "3 weeks",
    deadline: "2026-04-05",
    skills: ["Midjourney", "Stable Diffusion"],
    postedAt: "2026-04-22",
  },
  {
    id: 1003,
    crewId: "s2",
    crewName: "深港品牌宣传片组",
    crewCover: MOCK_CREWS[1].coverImage,
    roleName: "调色师",
    budget: "¥3000-5000",
    period: "1 week",
    deadline: "2026-04-03",
    skills: ["DaVinci Resolve", "色彩科学"],
    postedAt: "2026-04-24",
  },
  {
    id: 1004,
    crewId: "s4",
    crewName: "虚空传说10集动画",
    crewCover: MOCK_CREWS[3].coverImage,
    roleName: "编剧",
    budget: "¥4000-8000",
    period: "4 weeks",
    deadline: "2026-05-15",
    skills: ["剧本创作", "AI 短剧叙事"],
    postedAt: "2026-04-20",
  },
];

const MOCK_MY_APPLICATIONS: JobApplication[] = [
  {
    id: 9001,
    jobId: 1001,
    crewId: "s1",
    crewName: "赛博山海经预告片组",
    crewCover: MOCK_CREWS[0].coverImage,
    roleName: "分镜师",
    status: "pending",
    message: "三年分镜经验，作品集见 portfolio。",
    appliedAt: "2026-04-25T10:30:00Z",
  },
  {
    id: 9002,
    jobId: 1003,
    crewId: "s2",
    crewName: "深港品牌宣传片组",
    crewCover: MOCK_CREWS[1].coverImage,
    roleName: "调色师",
    status: "approved",
    message: "DaVinci 5 年经验，附风格示例。",
    appliedAt: "2026-04-21T08:15:00Z",
    respondedAt: "2026-04-22T11:00:00Z",
  },
  {
    id: 9003,
    jobId: 1002,
    crewId: "s1",
    crewName: "赛博山海经预告片组",
    crewCover: MOCK_CREWS[0].coverImage,
    roleName: "AI画师",
    status: "rejected",
    message: "可以承接 10 套精修。",
    appliedAt: "2026-04-19T14:00:00Z",
    respondedAt: "2026-04-20T09:30:00Z",
    rejectionReason: "已招满,谢谢申请。",
  },
];

const MOCK_APPLICANTS: Record<number, JobApplicant[]> = {
  1001: [
    {
      id: 8001,
      userId: 101,
      userName: "夜行画师",
      userAvatar: "",
      jobId: 1001,
      roleName: "分镜师",
      level: "FD3",
      status: "pending",
      message: "5 年分镜经验，最近完成《雾都谍影》系列。",
      portfolioUrl: "https://portfolio.example/yexing",
      appliedAt: "2026-04-25T09:00:00Z",
    },
    {
      id: 8002,
      userId: 102,
      userName: "Studio K",
      userAvatar: "",
      jobId: 1001,
      roleName: "分镜师",
      level: "FD2",
      status: "pending",
      message: "可以承接 60 格分镜，2 周交付。",
      portfolioUrl: "https://portfolio.example/k",
      appliedAt: "2026-04-24T19:42:00Z",
    },
    {
      id: 8003,
      userId: 103,
      userName: "回声 Echo",
      userAvatar: "",
      jobId: 1001,
      roleName: "分镜师",
      level: "FD4",
      status: "approved",
      message: "已审看脚本,愿意加入。",
      portfolioUrl: "https://portfolio.example/echo",
      appliedAt: "2026-04-22T08:00:00Z",
    },
  ],
  1002: [
    {
      id: 8101,
      userId: 201,
      userName: "像素工坊",
      userAvatar: "",
      jobId: 1002,
      roleName: "AI画师",
      level: "FD3",
      status: "pending",
      message: "MJ + SD 工作流,3 套精修风格示例已提交。",
      portfolioUrl: "https://portfolio.example/pixel",
      appliedAt: "2026-04-26T10:00:00Z",
    },
  ],
};

// In-memory mutation cache so the demo flow (apply / approve / reject)
// reflects state changes without a backend. Cleared on full reload.
export const mutationState = {
  applications: [...MOCK_MY_APPLICATIONS],
  applicantsByJob: structuredClone(MOCK_APPLICANTS) as Record<number, JobApplicant[]>,
};

// ─── Status presentation maps (workspace) ──────────────

export const STATUS_COLOR: Record<EpMemberStatus, string> = {
  approved: "text-green-400 bg-green-400/10 border-green-400/30",
  submitted: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  in_progress: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  rejected: "text-red-400 bg-red-400/10 border-red-400/30",
};

export const STATUS_LABEL_KEY: Record<EpMemberStatus, string> = {
  approved: "msApproved",
  submitted: "msSubmitted",
  in_progress: "msInProgress",
  rejected: "msRejected",
};
