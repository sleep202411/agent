/**
 * Crews feature data layer.
 *
 * Mirrors the IP feature's reference implementation (see
 * `app/(site)/ips/_hooks/use-ip.ts`): types, fetchers, React Query
 * hooks, and cache keys all live here. Crew routes import only from
 * this file (or sibling _data / _components), never from `src/hooks/*`.
 *
 * ## Backend status
 *
 * The crew backend isn't ready yet. Every fetcher in this file is
 * **mock-backed** — it imports the existing mock data under
 * `_components/{crew,workspace}-mock.ts` (and inlines a few extra
 * datasets for applicants / applications / open jobs) and returns it
 * after a small delay so React Query's loading states behave realistically.
 *
 * When the real endpoints come online, only the bodies of the fetcher
 * functions change. Hook signatures, types, and cache keys stay put,
 * so consuming pages keep working unchanged.
 *
 * ## Endpoint map (target)
 *
 *   POST /project/myprojects        → fetchMyOwnedCrews
 *   POST /project/myjoined          → fetchMyJoinedCrews
 *   POST /project/list              → searchCrews        (legacy: 广场列表)
 *   POST /project/query             → fetchCrewDetail
 *   POST /project/create            → createCrew
 *   POST /project/update            → updateCrew
 *   POST /project/member/query      → fetchCrewMembers
 *   POST /project/job/project/list  → fetchCrewJobs
 *   POST /project/job/find/jobs     → searchOpenJobs     (legacy: joinCrew)
 *   POST /project/job/create        → createJob
 *   POST /project/job/close         → closeJob
 *   POST /project/job/apply         → applyToJob
 *   POST /project/job/hasApply      → useHasApplied
 *   POST /project/job/myapply       → fetchMyApplications
 *   POST /project/job/applicant     → fetchJobApplicants
 *   POST /project/job/aggree        → agreeApplicant
 *   POST /project/job/refuse        → rejectApplicant
 */

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MOCK_CREWS,
  MOCK_CREW_DETAIL,
  MOCK_ACTIVITIES,
  PLATFORM_STATS,
} from "../_components/crew-mock";
import {
  MOCK_WORKSPACE,
  CURRENT_EP_MEMBERS,
  ROLES_PROGRESS,
  TODOS,
  ACTIVITY_LIST,
  MOCK_EPISODES,
  DELIVERY_RECORDS,
} from "../_components/workspace-mock";

// Re-export shape types so pages import only from here.
export type {
  CrewItem,
  ActivityItem,
  StatusStyle,
  CrewPhase,
  CrewRole,
  CrewMember,
  CrewDetail,
} from "../_components/crew-mock";
export type {
  WorkspaceStudio,
  EpMember,
  RoleProgress,
  TodoItem,
  WorkspaceActivity,
  EpisodeData,
  DeliveryRecord,
} from "../_components/workspace-mock";
export {
  STATUS_CONFIG,
  PHASE_DOT,
  STATUS_TABS,
  ROLE_FILTERS,
  PLATFORM_STATS,
} from "../_components/crew-mock";
export { EP_STATUS_COLOR, MEMBER_STATUS_META, MEMBER_ACTIONS } from "../_components/workspace-mock";

import type { CrewItem, CrewDetail } from "../_components/crew-mock";
import type {
  WorkspaceStudio,
  EpMember,
  RoleProgress,
  TodoItem,
  WorkspaceActivity,
  EpisodeData,
  DeliveryRecord,
} from "../_components/workspace-mock";

// ─── New types (no existing mock coverage) ──────────────

export interface OpenJob {
  id: number;
  crewId: string;
  crewName: string;
  crewCover: string;
  roleName: string;
  budget: string;
  period: string;
  deadline: string;
  skills: string[];
  postedAt: string;
}

export type ApplicationStatus = "pending" | "approved" | "rejected";

export interface JobApplication {
  id: number;
  jobId: number;
  crewId: string;
  crewName: string;
  crewCover: string;
  roleName: string;
  status: ApplicationStatus;
  message: string;
  appliedAt: string;
  respondedAt?: string;
  rejectionReason?: string;
}

export interface JobApplicant {
  id: number;
  userId: number;
  userName: string;
  userAvatar: string;
  jobId: number;
  roleName: string;
  level: string;
  status: ApplicationStatus;
  message: string;
  portfolioUrl: string;
  appliedAt: string;
}

// ─── Mock-only datasets ────────────────────────────────

const MOCK_OPEN_JOBS: OpenJob[] = [
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

// ─── Mock helpers ──────────────────────────────────────

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// In-memory mutation cache so the demo flow (apply / approve / reject)
// reflects state changes without a backend. Cleared on full reload.
const mutationState = {
  applications: [...MOCK_MY_APPLICATIONS],
  applicantsByJob: structuredClone(MOCK_APPLICANTS) as Record<number, JobApplicant[]>,
};

// ─── Mock fetchers ─────────────────────────────────────

interface CrewListFilter {
  search?: string;
  status?: string;
  role?: string;
}

async function searchCrews(filter: CrewListFilter = {}): Promise<CrewItem[]> {
  await delay(200);
  let items: CrewItem[] = [...MOCK_CREWS];
  if (filter.search) {
    const q = filter.search.toLowerCase();
    items = items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.ipName.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }
  if (filter.status && filter.status !== "all") {
    items = items.filter((c) => c.status === filter.status);
  }
  if (filter.role) {
    items = items.filter((c) => c.rolesNeeded.includes(filter.role!));
  }
  return items;
}

async function fetchMyOwnedCrews(): Promise<CrewItem[]> {
  await delay(200);
  return MOCK_CREWS.slice(0, 2);
}

async function fetchMyJoinedCrews(): Promise<CrewItem[]> {
  await delay(200);
  return MOCK_CREWS.slice(2, 5);
}

async function fetchCrewDetail(id: string): Promise<CrewDetail | null> {
  await delay(220);
  if (id !== MOCK_CREW_DETAIL.id && !MOCK_CREWS.some((c) => c.id === id)) {
    return null;
  }
  return { ...MOCK_CREW_DETAIL, id };
}

export interface WorkspaceData {
  studio: WorkspaceStudio;
  currentEpMembers: EpMember[];
  rolesProgress: RoleProgress[];
  todos: TodoItem[];
  activity: WorkspaceActivity[];
  episodes: EpisodeData[];
  delivery: DeliveryRecord[];
}

// Member-action types — mirrors backend semantics so the swap is mechanical.
export type EpMemberAction = "approve" | "reject" | "remind" | "submitReview";

export type EpMemberStatus = "approved" | "submitted" | "in_progress" | "rejected";

const STATUS_COLOR: Record<EpMemberStatus, string> = {
  approved: "text-green-400 bg-green-400/10 border-green-400/30",
  submitted: "text-blue-400 bg-blue-400/10 border-blue-400/30",
  in_progress: "text-amber-400 bg-amber-400/10 border-amber-400/30",
  rejected: "text-red-400 bg-red-400/10 border-red-400/30",
};

const STATUS_LABEL_KEY: Record<EpMemberStatus, string> = {
  approved: "msApproved",
  submitted: "msSubmitted",
  in_progress: "msInProgress",
  rejected: "msRejected",
};

async function fetchCrewWorkspace(id: string): Promise<WorkspaceData> {
  await delay(260);
  return {
    studio: { ...MOCK_WORKSPACE, name: id ? MOCK_WORKSPACE.name : MOCK_WORKSPACE.name },
    currentEpMembers: CURRENT_EP_MEMBERS,
    rolesProgress: ROLES_PROGRESS,
    todos: TODOS,
    activity: ACTIVITY_LIST,
    episodes: MOCK_EPISODES,
    delivery: DELIVERY_RECORDS,
  };
}

async function searchOpenJobs(filter: { roleName?: string } = {}): Promise<OpenJob[]> {
  await delay(180);
  if (!filter.roleName) return MOCK_OPEN_JOBS;
  return MOCK_OPEN_JOBS.filter((j) => j.roleName === filter.roleName);
}

async function fetchMyApplications(): Promise<JobApplication[]> {
  await delay(180);
  return [...mutationState.applications];
}

async function hasAppliedToJob(jobId: number): Promise<boolean> {
  await delay(120);
  return mutationState.applications.some((a) => a.jobId === jobId);
}

async function fetchJobApplicants(jobId: number): Promise<JobApplicant[]> {
  await delay(220);
  return mutationState.applicantsByJob[jobId] ?? [];
}

interface ActivityFeedResult {
  recent: typeof MOCK_ACTIVITIES;
  stats: typeof PLATFORM_STATS;
}

async function fetchCrewLanding(): Promise<ActivityFeedResult> {
  await delay(180);
  return { recent: MOCK_ACTIVITIES, stats: PLATFORM_STATS };
}

// ─── Mock mutations ────────────────────────────────────

async function applyToJob({
  jobId,
  message,
}: {
  jobId: number;
  message: string;
}): Promise<JobApplication> {
  await delay(300);
  const job = MOCK_OPEN_JOBS.find((j) => j.id === jobId);
  if (!job) throw new Error("Job not found");
  if (mutationState.applications.some((a) => a.jobId === jobId)) {
    throw new Error("Already applied");
  }
  const application: JobApplication = {
    id: Date.now(),
    jobId,
    crewId: job.crewId,
    crewName: job.crewName,
    crewCover: job.crewCover,
    roleName: job.roleName,
    status: "pending",
    message,
    appliedAt: new Date().toISOString(),
  };
  mutationState.applications = [application, ...mutationState.applications];
  return application;
}

async function agreeApplicant(applicantId: number): Promise<void> {
  await delay(200);
  for (const [jobId, list] of Object.entries(mutationState.applicantsByJob)) {
    const idx = list.findIndex((a) => a.id === applicantId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], status: "approved" };
      mutationState.applicantsByJob[Number(jobId)] = [...list];
      return;
    }
  }
  throw new Error("Applicant not found");
}

async function rejectApplicant({
  applicantId,
}: {
  applicantId: number;
  reason?: string;
}): Promise<void> {
  await delay(200);
  for (const [jobId, list] of Object.entries(mutationState.applicantsByJob)) {
    const idx = list.findIndex((a) => a.id === applicantId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], status: "rejected" };
      mutationState.applicantsByJob[Number(jobId)] = [...list];
      return;
    }
  }
  throw new Error("Applicant not found");
}

async function createCrew(data: {
  name: string;
  ipName?: string;
  description: string;
}): Promise<{ id: string }> {
  await delay(300);
  return { id: `s_${Date.now()}` };
}

async function updateCrew(_data: { id: string }): Promise<void> {
  await delay(200);
}

async function createJob(_data: {
  crewId: string;
  roleName: string;
  budget: string;
  deadline: string;
}): Promise<{ id: number }> {
  await delay(220);
  return { id: Date.now() };
}

async function closeJob(_jobId: number): Promise<void> {
  await delay(180);
}

// ─── Query keys ────────────────────────────────────────

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
};

// ─── Hooks ─────────────────────────────────────────────

export function useCrews(filter: CrewListFilter = {}) {
  return useQuery({
    queryKey: crewKeys.list(filter),
    queryFn: () => searchCrews(filter),
  });
}

export function useMyOwnedCrews() {
  return useQuery({
    queryKey: crewKeys.myOwned,
    queryFn: fetchMyOwnedCrews,
  });
}

export function useMyJoinedCrews() {
  return useQuery({
    queryKey: crewKeys.myJoined,
    queryFn: fetchMyJoinedCrews,
  });
}

export function useCrewDetail(id: string) {
  return useQuery({
    queryKey: crewKeys.detail(id),
    queryFn: () => fetchCrewDetail(id),
    enabled: !!id,
  });
}

export function useCrewWorkspace(id: string) {
  return useQuery({
    queryKey: crewKeys.workspace(id),
    queryFn: () => fetchCrewWorkspace(id),
    enabled: !!id,
  });
}

export function useOpenJobs(filter: { roleName?: string } = {}) {
  return useQuery({
    queryKey: crewKeys.openJobs(filter),
    queryFn: () => searchOpenJobs(filter),
  });
}

export function useMyApplications() {
  return useQuery({
    queryKey: crewKeys.myApplications,
    queryFn: fetchMyApplications,
  });
}

export function useHasApplied(jobId: number | null) {
  return useQuery({
    queryKey: crewKeys.hasApplied(jobId ?? 0),
    queryFn: () => hasAppliedToJob(jobId!),
    enabled: jobId != null,
  });
}

export function useJobApplicants(jobId: number | null) {
  return useQuery({
    queryKey: crewKeys.applicants(jobId ?? 0),
    queryFn: () => fetchJobApplicants(jobId!),
    enabled: jobId != null,
  });
}

export function useCrewLanding() {
  return useQuery({
    queryKey: crewKeys.landing,
    queryFn: fetchCrewLanding,
  });
}

// ─── Mutations ─────────────────────────────────────────

export function useApplyToJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: applyToJob,
    onSuccess: (_app, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.myApplications });
      qc.invalidateQueries({ queryKey: crewKeys.hasApplied(vars.jobId) });
    },
  });
}

export function useAgreeApplicant(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: agreeApplicant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.applicants(jobId) });
    },
  });
}

export function useRejectApplicant(jobId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rejectApplicant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.applicants(jobId) });
    },
  });
}

export function useCreateCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createCrew,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.myOwned });
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
    },
  });
}

export function useUpdateCrew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateCrew,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(vars.id) });
      qc.invalidateQueries({ queryKey: ["crew", "list"] });
    },
  });
}

export function useCreateJob(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createJob,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.detail(crewId) });
      qc.invalidateQueries({ queryKey: ["crew", "openJobs"] });
    },
  });
}

export function useCloseJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: closeJob,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crew", "openJobs"] });
    },
  });
}

// ─── Workspace mutations ───────────────────────────────
//
// These mutate the React Query cache directly via `setQueryData` so the
// UI updates immediately without a refetch round-trip. When the real
// backend lands, switch the `mutationFn` body to a fetch call — the
// `onSuccess` cache write keeps optimistic-feeling UX.
//
// Endpoint targets (when wired):
//   POST /project/episode/member/status   → setEpisodeMemberStatus
//   POST /project/episode/submit          → submitEpisodeToClient
//   POST /project/todo/toggle             → toggleTodoDone
//   POST /project/member/invite           → inviteMember

async function setEpisodeMemberStatus(_args: {
  crewId: string;
  memberName: string;
  action: EpMemberAction;
  reason?: string;
}): Promise<void> {
  await delay(220);
}

async function submitEpisodeToClient(_args: {
  crewId: string;
  episodeNumber: number;
}): Promise<void> {
  await delay(280);
}

async function toggleTodoDone(_args: {
  crewId: string;
  todoIndex: number;
  done: boolean;
}): Promise<void> {
  await delay(160);
}

async function inviteMember(_args: { crewId: string; identifier: string }): Promise<void> {
  await delay(240);
}

export function useEpisodeMemberAction(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setEpisodeMemberStatus,
    onSuccess: (_void, vars) => {
      // Apply the result to the cached workspace so the row flips immediately.
      if (vars.action === "remind") return; // no state change
      const nextStatus: EpMemberStatus =
        vars.action === "approve"
          ? "approved"
          : vars.action === "reject"
            ? "rejected"
            : "submitted";
      qc.setQueryData<WorkspaceData>(crewKeys.workspace(crewId), (old) => {
        if (!old) return old;
        return {
          ...old,
          currentEpMembers: old.currentEpMembers.map((m) =>
            m.name === vars.memberName
              ? {
                  ...m,
                  status: nextStatus,
                  statusLabelKey: STATUS_LABEL_KEY[nextStatus],
                  color: STATUS_COLOR[nextStatus],
                  updated: "Just now",
                }
              : m
          ),
        };
      });
    },
  });
}

export function useSubmitEpisodeToClient(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitEpisodeToClient,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.workspace(crewId) });
    },
  });
}

export function useToggleTodoDone(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: toggleTodoDone,
    onSuccess: (_void, vars) => {
      // We don't have a `done` field on TodoItem yet; the page tracks
      // local Set<number> for now. Once backend adds it, mutate cache here.
      qc.invalidateQueries({ queryKey: crewKeys.workspace(crewId) });
    },
  });
}

export function useInviteMember(crewId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: inviteMember,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: crewKeys.workspace(crewId) });
    },
  });
}
