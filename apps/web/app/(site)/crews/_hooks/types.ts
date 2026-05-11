/**
 * Public-facing types for the crews feature data layer. Re-exported
 * through `_hooks/use-crew` so route / component code only ever imports
 * from there.
 */

// ─── Applicants ────────────────────────────────────────

export type ApplicationStatus = "pending" | "approved" | "rejected";

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
 * controller). Three user-supplied fields (the "crew basic info" step
 * of the phase-1 spec):
 *
 *   name        — required; crew display name
 *   banner      — required; OSS storage path of the cover image
 *   description — required; freeform description
 *
 * Backend also accepts `video` (OSS path) and `ipId`; neither is
 * surfaced in this type. The video upload UI is removed pending a
 * proper presigned-URL endpoint for crews (the existing `uploadBanner`
 * fallback was semantically wrong); `ipId` is excluded by product
 * decision (2026-05-08) — crews are not bound to an IP in the UI.
 */
export interface CreateCrewInput {
  name: string;
  banner: string;
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
