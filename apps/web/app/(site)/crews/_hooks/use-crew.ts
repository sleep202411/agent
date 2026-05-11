/**
 * Crews feature data layer — single import surface for routes / components.
 *
 * The actual implementations live in the sibling domain files
 * (`use-crew-list.ts`, `use-crew-detail.ts`, `use-jobs.ts`,
 * `use-applications.ts`, `use-members.ts`); this file is a barrel
 * re-export so consumers can keep importing from `_hooks/use-crew`
 * regardless of how the data layer is split internally.
 */

"use client";

export { crewKeys } from "./shared";

export type {
  ApplicationStatus,
  CreateCrewInput,
  CreateJobInput,
  JobApplicant,
  UpdateCrewInput,
} from "./types";

export { useMyCrews, useQueryCrewList } from "./use-crew-list";
export type { QueryCrewListItem } from "./use-crew-list";

export {
  useCreateCrew,
  useCrewDetail,
  useUpdateCrew,
  useUpdateCrewStatus,
} from "./use-crew-detail";

export { useCloseJob, useCreateJob, useCrewJobs, usePublicCrewJobs } from "./use-jobs";
export type { CrewJob } from "./use-jobs";

export {
  useAgreeApplicant,
  useApplyToJob,
  useJobApplicants,
  useRejectApplicant,
} from "./use-applications";

export {
  useAddCrewMember,
  useCrewMembers,
  useRemoveMember,
  type AddCrewMemberInput,
  type CrewMemberWire,
} from "./use-members";
