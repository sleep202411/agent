/**
 * Public-facing types for the crews feature data layer. Re-exported
 * through `_hooks/use-crew` so route / component code only ever imports
 * from there.
 */

// ─── Open jobs / applications ──────────────────────────

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

// ─── Crew + job mutations ──────────────────────────────

export interface CreateCrewInput {
  name: string;
  ipName?: string;
  description?: string;
  /** Project category code, e.g. "basicAIDrama" / "premiumAd". */
  projectType: string;
  /** ISO date (YYYY-MM-DD). */
  deadline?: string;
  /** Free-form display string, e.g. "¥3k-8k". */
  budgetRange?: string;
  /** Initial production phase, e.g. "preProduction". */
  startPhase: string;
  /** Open roles to recruit. */
  roles: { name: string; count: number }[];
}

export interface UpdateCrewInput extends Partial<CreateCrewInput> {
  id: string;
}

export interface CreateJobInput {
  crewId: string;
  roleName: string;
  budget: string;
  /** Display string ("2 weeks") or ISO duration. */
  period?: string;
  deadline: string;
  skills?: string[];
  /** Optional headcount; backend defaults to 1. */
  count?: number;
  /** Free-form description of what the role delivers. */
  deliverable?: string;
}

export interface UpdateJobInput extends Partial<CreateJobInput> {
  id: number;
  /** Used only for cache invalidation; not part of the backend payload. */
  crewId: string;
}

// ─── Workspace ─────────────────────────────────────────

import type {
  WorkspaceStudio,
  EpMember,
  RoleProgress,
  TodoItem,
  WorkspaceActivity,
  EpisodeData,
  DeliveryRecord,
} from "../_components/workspace-mock";

export interface WorkspaceData {
  studio: WorkspaceStudio;
  currentEpMembers: EpMember[];
  rolesProgress: RoleProgress[];
  todos: TodoItem[];
  activity: WorkspaceActivity[];
  episodes: EpisodeData[];
  delivery: DeliveryRecord[];
}

export type EpMemberAction = "approve" | "reject" | "remind" | "submitReview";

export type EpMemberStatus = "approved" | "submitted" | "in_progress" | "rejected";

// ─── Producer Workbench ────────────────────────────────

export interface ProducerProject {
  id: string;
  name: string;
  status: "Not Started" | "In Production" | "Post-production" | "Completed";
  phase: string;
  /** 0-100 progress percent. */
  progress: number;
  budget: number;
  spent: number;
  members: number;
  urgentCheckpoints: number;
  pendingTasks: number;
  /** ISO date. */
  deadline: string;
  /** Health flag, drives the dot color in the workbench table. */
  health: "good" | "warning" | "risk";
}

export interface PendingCheckpoint {
  id: string;
  project: string;
  /** Production stage, e.g. "Storyboard" / "AI Image Gen". */
  stage: string;
  /** SLA copy, e.g. "6h until timeout" / "Due tomorrow". */
  sla: string;
  urgent: boolean;
}

export interface FinanceSummary {
  /** Total committed budget across all the producer's active projects. */
  totalBudget: number;
  /** Already-disbursed amount. */
  totalSpent: number;
  /** Currently held in escrow pending checkpoint approval. */
  escrowHeld: number;
  /** Approved-but-not-yet-released funds. */
  pendingRelease: number;
}

export interface ProducerOverview {
  projects: ProducerProject[];
  pendingCheckpoints: PendingCheckpoint[];
  finance: FinanceSummary;
  /** Aggregate counts for the top stat cards. */
  stats: {
    activeProjects: number;
    pendingCheckpoints: number;
    dueThisWeek: number;
    totalTeam: number;
  };
}

// ─── Re-exported nested types from mock (single import surface) ────

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
