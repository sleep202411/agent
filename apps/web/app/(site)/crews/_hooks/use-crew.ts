/**
 * Crews feature data layer — single import surface for routes / components.
 *
 * The actual implementations live in the sibling domain files
 * (`use-crew-list.ts`, `use-crew-detail.ts`, `use-jobs.ts`,
 * `use-applications.ts`, `use-members.ts`, `use-workspace.ts`,
 * `use-producer.ts`); this file is a barrel re-export so consumers can
 * keep importing from `_hooks/use-crew` regardless of how the data
 * layer is split internally.
 *
 * Mirrors the IP feature's reference layout (`app/(site)/ips/_hooks/`).
 */

"use client";

// ─── Shared (cache keys + helpers) ─────────────────────
export { crewKeys } from "./shared";

// ─── Public types ──────────────────────────────────────
export type {
  ActivityItem,
  ApplicationStatus,
  CreateCrewInput,
  CreateJobInput,
  CrewDetail,
  CrewItem,
  CrewMember,
  CrewPhase,
  CrewRole,
  DeliveryRecord,
  EpMember,
  EpMemberAction,
  EpMemberStatus,
  EpisodeData,
  FinanceSummary,
  JobApplicant,
  JobApplication,
  OpenJob,
  PendingCheckpoint,
  ProducerOverview,
  ProducerProject,
  RoleProgress,
  StatusStyle,
  TodoItem,
  UpdateCrewInput,
  UpdateJobInput,
  WorkspaceActivity,
  WorkspaceData,
  WorkspaceStudio,
} from "./types";

// ─── Presentation constants (re-exported from mocks) ───
export {
  PHASE_DOT,
  PLATFORM_STATS,
  ROLE_FILTERS,
  STATUS_CONFIG,
  STATUS_TABS,
} from "../_components/crew-mock";
export { EP_STATUS_COLOR, MEMBER_ACTIONS, MEMBER_STATUS_META } from "../_components/workspace-mock";

// ─── List + landing ────────────────────────────────────
export { useCrewLanding, useCrews, useMyJoinedCrews, useMyOwnedCrews } from "./use-crew-list";

// ─── Detail + crew CRUD ────────────────────────────────
export { useCreateCrew, useCrewDetail, useDeleteCrew, useUpdateCrew } from "./use-crew-detail";

// ─── Jobs ──────────────────────────────────────────────
export { useCloseJob, useCreateJob, useDeleteJob, useOpenJobs, useUpdateJob } from "./use-jobs";

// ─── Applications ──────────────────────────────────────
export {
  useAgreeApplicant,
  useApplyToJob,
  useHasApplied,
  useJobApplicants,
  useMyApplications,
  useRejectApplicant,
} from "./use-applications";

// ─── Members ───────────────────────────────────────────
export {
  useCrewMembers,
  useAddCrewMember,
  useInviteMember,
  useRemoveMember,
  type AddCrewMemberInput,
  type CrewMemberWire,
} from "./use-members";

// ─── Workspace ─────────────────────────────────────────
export {
  useCrewWorkspace,
  useEpisodeMemberAction,
  useSubmitEpisodeToClient,
  useToggleTodoDone,
} from "./use-workspace";

// ─── Producer Workbench ────────────────────────────────
export { useProducerOverview } from "./use-producer";
