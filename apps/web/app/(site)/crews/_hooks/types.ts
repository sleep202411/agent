/**
 * Re-export shared crew DTOs as the feature's public type surface.
 *
 * Everything user-facing in this feature should import from here (or
 * from the `use-crew` barrel that re-exports from here) — not from
 * `@repo/shared` directly. Keeping one import surface means a future
 * type migration (e.g. server splits CrewDTO into multiple wire
 * shapes) is a single-file change instead of grepping every import
 * site.
 */

export type {
  CrewDTO,
  CrewListingStatus,
  CrewPositionDTO,
  CrewPositionPageDTO,
  CrewPositionStatus,
  CrewMemberDTO,
  CrewMemberPageDTO,
  CrewMembershipDTO,
  CrewMemberVia,
  CrewApplicationDTO,
  CrewApplicationListSummary,
  CrewApplicationPageDTO,
  CrewApplicationStatus,
  PresetPositionValue,
  WorkMode,
  EmploymentType,
  ExperienceLevel,
  SalaryPeriod,
  CurrencyCode,
  CrewGenre,
  CrewStyle,
  SocialPlatform,
  SocialLink,
  ShowcaseWork,
} from "@repo/shared/crew";

export {
  PRESET_POSITIONS,
  OWNER_ROLE,
  isPresetPosition,
  isValidRoleType,
  WORK_MODES,
  EMPLOYMENT_TYPES,
  EXPERIENCE_LEVELS,
  SALARY_PERIODS,
  ALL_CURRENCIES,
  CURRENCY_SYMBOLS,
  ZERO_DECIMAL_CURRENCIES,
  CREW_GENRES,
  CREW_STYLES,
  SOCIAL_PLATFORMS,
} from "@repo/shared/crew";

// ─── Input shapes (controllers' Zod-validated body types) ─────

import type {
  CrewListingStatus,
  CrewGenre,
  CrewStyle,
  CurrencyCode,
  ExperienceLevel,
  SalaryPeriod,
  SocialLink,
  ShowcaseWork,
} from "@repo/shared/crew";

export interface CreateCrewInput {
  name: string;
  description: string;
  logo: string;
  tagline?: string | null;
  genres?: CrewGenre[];
  styles?: CrewStyle[];
  socialLinks?: SocialLink[];
  showcaseWorks?: ShowcaseWork[];
}

export interface UpdateCrewInput extends Partial<CreateCrewInput> {
  id: string;
}

export interface UpdateCrewListingInput {
  id: string;
  listingStatus: CrewListingStatus;
  expectedVersion?: number;
}

export interface SalaryInput {
  period?: "month" | "episode" | "project" | null;
  /** ISO 4217. Required when amounts are set. */
  currency?: import("@repo/shared/crew").CurrencyCode | null;
  /** Display unit (yuan / dollar / yen). Server converts to smallest unit. */
  min?: number | null;
  max?: number | null;
  negotiable?: boolean;
}

export interface CreatePositionInput {
  positionType: string;
  description: string;
  targetCount: number;
  workMode?: "remote" | "hybrid" | "onsite";
  location?: string | null;
  employmentType?: "full_time" | "part_time" | "contract" | "freelance" | "project_based";
  experienceLevel?: ExperienceLevel;
  requiredSkills?: string[];
  salary?: SalaryInput;
  /** Months of commitment (1-60). null = long-term / open-ended. */
  durationMonths?: number | null;
  /** Revenue share % (0.5-50, step 0.5). null = no share. */
  revenueSharePercent?: number | null;
  /** YYYY-MM-DD. */
  closeDate?: string | null;
}

export interface UpdatePositionInput extends Partial<CreatePositionInput> {
  status?: "open" | "frozen";
}

export interface ApplyInput {
  message?: string | null;
  portfolioUrl?: string | null;
  /** New shape: display amount + ISO currency; server stores smallest unit. */
  expectedCompensation?: {
    amount?: number | null;
    currency?: CurrencyCode | null;
    period?: SalaryPeriod | null;
  } | null;
  /** YYYY-MM-DD. */
  availableStartDate?: string | null;
  yearsExperience?: number | null;
}

export interface CreateCrewInvitationInput {
  account: string;
  roleType: string;
  agreement?: {
    signerName: string;
    signerEmail: string;
    title: string;
  };
}

export type CrewTaskStatus =
  | "open"
  | "in_progress"
  | "submitted"
  | "revision_requested"
  | "approved"
  | "cancelled";
export type CrewTaskPriority = "low" | "normal" | "high" | "urgent";
export type CrewTaskViewLayout = "table" | "board" | "calendar" | "timeline";
export type CrewTaskViewScope = "backlog" | "active" | "review" | "completed" | "all";
export type CrewTaskViewGroup = "none" | "status" | "priority" | "assignee" | "cycle";
export type CrewTaskFieldType =
  | "text"
  | "number"
  | "single_select"
  | "multi_select"
  | "date"
  | "checkbox"
  | "user";
export type CrewTaskCustomValue = string | number | boolean | string[] | null;

export interface CrewTaskWorkflowStateDTO {
  id: string;
  crewId: string;
  name: string;
  color: string;
  semantic: CrewTaskStatus;
  systemKey: CrewTaskStatus | null;
  position: number;
  archived: boolean;
  version: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewTaskLabelDTO {
  id: string;
  crewId: string;
  name: string;
  color: string;
  description: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewTaskCycleDTO {
  id: string;
  crewId: string;
  number: number;
  name: string;
  goal: string;
  status: "planned" | "active" | "completed" | "cancelled";
  startAt: string;
  endAt: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewTaskFieldDTO {
  id: string;
  crewId: string;
  name: string;
  description: string;
  type: CrewTaskFieldType;
  options: Array<{ id: string; label: string; color?: string }>;
  position: number;
  required: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewTaskViewDTO {
  id: string;
  crewId: string;
  name: string;
  layout: CrewTaskViewLayout;
  scope: CrewTaskViewScope;
  groupBy: Exclude<CrewTaskViewGroup, "none"> | null;
  filters: {
    workflowStateIds?: string[];
    priorities?: CrewTaskPriority[];
    assigneeUserIds?: string[];
    cycleIds?: string[];
    labelIds?: string[];
    unassigned?: boolean;
    overdue?: boolean;
  };
  sorts: Array<{
    field: "rank" | "number" | "title" | "status" | "priority" | "startAt" | "dueAt" | "updatedAt";
    direction: "asc" | "desc";
  }>;
  visibleFields: string[];
  position: number;
  isSystem: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewTaskProjectDTO {
  views: CrewTaskViewDTO[];
  cycles: CrewTaskCycleDTO[];
  labels: CrewTaskLabelDTO[];
  fields: CrewTaskFieldDTO[];
  workflowStates: CrewTaskWorkflowStateDTO[];
}

export interface CrewTaskAssigneeDTO {
  id: string;
  userId: string;
  crewMemberId: string;
  rewardPoints: number | null;
  assignedAt: string;
}

export interface CrewTaskSubmissionDTO {
  id: string;
  versionNumber: number;
  submittedByUserId: string;
  note: string;
  canvasVersionId: string | null;
  productionVersionId: string | null;
  reviewNote: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  mergedAt: string | null;
  createdAt: string;
  assets: Array<{
    id: string;
    name: string;
    mediaAssetId: string | null;
    contentType: string | null;
    sizeBytes: number | null;
  }>;
}

export interface CrewSettlementItemDTO {
  id: string;
  taskId: string;
  taskTitle: string | null;
  userId: string;
  pointsAmount: number;
  pointsPerUsd: number;
  payoutAmountMinor: number | null;
  payoutCurrency: string | null;
  accrualTransactionId: string;
  cashOutTransactionId: string | null;
  status: "pending" | "settled";
  settledAt: string | null;
  settledByUserId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrewSettlementPageDTO {
  items: CrewSettlementItemDTO[];
  nextCursor: string | null;
  total: number;
  summary: {
    total: number;
    pending: number;
    settled: number;
  };
}

export interface CrewTaskDTO {
  id: string;
  crewId: string;
  number: number;
  title: string;
  description: string;
  status: CrewTaskStatus;
  workflowStateId: string;
  workflowState: CrewTaskWorkflowStateDTO;
  priority: CrewTaskPriority;
  startAt: string | null;
  dueAt: string | null;
  estimatePoints: number | null;
  computeBudgetPoints: number | null;
  computeUsedPoints: number;
  revisionLimit: number | null;
  revisionRoundsUsed: number;
  rank: string;
  parentId: string | null;
  parent: CrewTaskReferenceDTO | null;
  children: CrewTaskReferenceDTO[];
  subtaskProgress: { total: number; completed: number };
  blockedBy: Array<CrewTaskReferenceDTO & { resolved: boolean }>;
  blocking: CrewTaskReferenceDTO[];
  customFieldValues: Array<{
    fieldId: string;
    value: Exclude<CrewTaskCustomValue, null>;
    updatedByUserId: string;
    updatedAt: string;
  }>;
  cycleId: string | null;
  cycle: CrewTaskCycleDTO | null;
  labels: CrewTaskLabelDTO[];
  version: number;
  canvasProjectId: string;
  canvasDocumentId: string;
  canvasHref: string;
  createdByUserId: string;
  approvedByUserId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignees: CrewTaskAssigneeDTO[];
  submissions: CrewTaskSubmissionDTO[];
  settlements: CrewSettlementItemDTO[];
}

export type CrewTaskListItemDTO = Omit<CrewTaskDTO, "submissions" | "settlements">;

export interface CrewTaskPageDTO {
  items: CrewTaskListItemDTO[];
  nextCursor: string | null;
  total: number;
  workflowCounts: Record<string, number>;
}

export interface CrewTaskOptionDTO {
  id: string;
  number: number;
  title: string;
  status: CrewTaskStatus;
  priority: CrewTaskPriority;
  workflowStateId: string;
  parentId: string | null;
}

export interface CrewTaskOptionPageDTO {
  items: CrewTaskOptionDTO[];
  nextCursor: string | null;
}

export interface CrewTaskSummaryDTO {
  total: number;
  active: number;
  myActive: number;
  pendingReview: number;
  completed: number;
  byStatus: Record<CrewTaskStatus, number>;
}

export interface CrewTaskReferenceDTO {
  id: string;
  number: number;
  title: string;
  status: CrewTaskStatus;
  workflowStateId: string;
  workflowState: CrewTaskWorkflowStateDTO;
  parentId: string | null;
}

export interface CrewTaskMentionDTO {
  userId: string;
  label: string;
}

export interface CrewTaskTimelineAttachmentDTO {
  id: string;
  name: string;
  mediaAssetId: string | null;
  mediaKind: "image" | "video" | "audio" | "document" | "other" | null;
  contentType: string | null;
  sizeBytes: number | null;
}

export interface CrewTaskTimelineItemDTO {
  id: string;
  taskId: string;
  kind: string;
  actorUserId: string | null;
  body: string | null;
  mentions: CrewTaskMentionDTO[];
  payload: Record<string, unknown>;
  replyTo: {
    id: string;
    kind: string;
    actorUserId: string | null;
    body: string | null;
    deleted: boolean;
  } | null;
  version: number;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: CrewTaskTimelineAttachmentDTO[];
}

export interface CrewTaskTimelinePageDTO {
  items: CrewTaskTimelineItemDTO[];
  nextCursor: string | null;
}

export interface UpdateCrewTaskInput {
  expectedVersion: number;
  title?: string;
  description?: string;
  priority?: CrewTaskPriority;
  startAt?: string | null;
  dueAt?: string | null;
  estimatePoints?: number | null;
  computeBudgetPoints?: number | null;
  revisionLimit?: number | null;
  cycleId?: string | null;
  parentId?: string | null;
  blockedByTaskIds?: string[];
  customFieldValues?: Array<{ fieldId: string; value: CrewTaskCustomValue }>;
  labelIds?: string[];
  workflowStateId?: string;
  assignees?: CreateCrewTaskInput["assignees"];
}

export type CrewTaskCommentAttachmentInput =
  | { source: "asset"; assetNodeId: string }
  | { source: "upload"; mediaAssetId: string; name: string };

export interface CreateCrewTaskCommentInput {
  body: string;
  mentions: CrewTaskMentionDTO[];
  replyToId?: string | null;
  attachments: CrewTaskCommentAttachmentInput[];
  clientKey: string;
}

export interface UpdateCrewTaskCommentInput {
  expectedVersion: number;
  body: string;
  mentions: CrewTaskMentionDTO[];
}

export interface CreateCrewTaskInput {
  title: string;
  description: string;
  workflowStateId?: string;
  priority: CrewTaskPriority;
  startAt?: string | null;
  dueAt?: string | null;
  estimatePoints?: number | null;
  computeBudgetPoints?: number | null;
  revisionLimit?: number | null;
  cycleId?: string | null;
  parentId?: string | null;
  blockedByTaskIds?: string[];
  customFieldValues?: Array<{ fieldId: string; value: CrewTaskCustomValue }>;
  labelIds?: string[];
  assignees: Array<{
    userId: string;
    rewardPoints?: number | null;
  }>;
}

export interface CrewInvitationDTO {
  id: string;
  crewId: string;
  inviteeUserId: string;
  invitedByUserId: string;
  roleType: string;
  status: "pending" | "accepted" | "declined" | "revoked" | "expired";
  expiresAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  revokedAt: string | null;
  agreementRequest: {
    title: string;
    signerName: string;
    signerEmail: string;
    agreementId: string | null;
    status: CrewAgreementStatus | null;
  } | null;
  createdAt: string;
  updatedAt: string;
  crew?: {
    id: string;
    name: string;
    logo: string;
    tagline: string | null;
  };
}

export interface CrewInvitationPageDTO {
  items: CrewInvitationDTO[];
  nextCursor: string | null;
  total: number;
}

export type CrewAgreementStatus =
  | "draft"
  | "sending"
  | "sent"
  | "signed"
  | "declined"
  | "expired"
  | "failed"
  | "voided";

export type CrewAgreementView = "all" | "active" | "signed" | "attention";
export type CrewAgreementArchiveStatus =
  | "not_applicable"
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export interface CrewAgreementDTO {
  id: string;
  crewId: string;
  memberUserId: string;
  signerName: string;
  signerEmail: string;
  title: string;
  provider: "boldsign";
  providerDocumentId: string | null;
  providerStatus: string | null;
  status: CrewAgreementStatus;
  capabilities: {
    sign: boolean;
  };
  delivery: {
    status: "pending" | "processing" | "completed" | "failed";
    attempt: number;
    error: string | null;
    canRetry: boolean;
  };
  archive: {
    status: CrewAgreementArchiveStatus;
    signedAssetNodeId: string | null;
    auditAssetNodeId: string | null;
    signedDocumentUrl: string | null;
    auditTrailUrl: string | null;
    attempt: number;
    canRetry: boolean;
  };
  sentAt: string | null;
  signedAt: string | null;
  lastSyncedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrewAgreementsResponse {
  capabilities: {
    create: boolean;
    sync: boolean;
    provider: "boldsign";
  };
  items: CrewAgreementDTO[];
  nextCursor: string | null;
  total: number;
  summary: Record<CrewAgreementView, number>;
}

export interface CreateCrewAgreementInput {
  memberUserId: string;
  signerName: string;
  signerEmail: string;
  title: string;
}

export interface CrewAgreementSigningSession {
  signLink: string;
  expiresAt: string;
}
