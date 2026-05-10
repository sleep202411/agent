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

/**
 * Wire-shape for `POST /project/crew/create` (backend `createCrew`
 * controller). Four fields, all under the "crew basic info" CRUD step
 * of the phase-1 spec:
 *
 *   name        — required; crew display name
 *   banner      — required; OSS storage path of the cover image
 *   video       — optional; OSS storage path of the cover video
 *   description — required; freeform description
 *
 * Backend also takes a fifth `ipId` field but the frontend does not
 * surface it (crews are not bound to an IP at the user-facing layer);
 * a 0 default would have to be sent if backend rejects missing fields.
 * Per product 2026-05-08: `ipId` is intentionally excluded from this
 * type so callers can't accidentally ship it.
 */
export interface CreateCrewInput {
  name: string;
  banner: string;
  video?: string;
  description: string;
}

export interface UpdateCrewInput extends Partial<CreateCrewInput> {
  id: string;
}

/**
 * Wire-shape for `POST /project/crew/job/create` (createCrewJob).
 *
 * Backend takes the fields below as **query params** today
 * (consistency-flagged TODO; same migration we're asking for as the
 * earlier add-member call). The mapping is:
 *
 *   crewId         (frontend) → projectId (wire)  — phase-1 backend
 *                                                   reuses the project
 *                                                   schema for crews
 *   roleId         (frontend) → roleId    (wire)  — id from
 *                                                   /project/role/list
 *   jobName        (frontend) → jobName   (wire)  — display label;
 *                                                   defaults to the
 *                                                   selected role's name
 *   jobDescription (frontend) → jobDescription    — recruiter copy
 *   jobNumber      (frontend) → jobNumber         — headcount
 *
 * **TODO(crew-phase-1)**: when backend ships query → JSON body and
 * confirms whether `jobName` should be denormalized or omitted, update
 * this type + the mutationFn body in `use-jobs.ts`.
 */
export interface CreateJobInput {
  /** Crew id (created via /project/crew/create). Sent as `projectId` on
   *  the wire because backend reuses the project entity for crews. */
  crewId: string;
  /** Role id from `/project/role/list`. Required. */
  roleId: number;
  /** Display label for the job. Phase-1 frontend uses the role's name
   *  by default; explicit override comes later if backend wants it. */
  jobName: string;
  /** Recruiter-authored description of the role. Required. */
  jobDescription: string;
  /** Headcount to recruit. Required, ≥ 1. */
  jobNumber: number;
}

export interface UpdateJobInput extends Partial<CreateJobInput> {
  id: number;
  /** Used only for cache invalidation; not part of the backend payload. */
  crewId: string;
}

// ─── Workspace ─────────────────────────────────────────

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
