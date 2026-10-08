import type { TaskPaymentTerms } from "@repo/shared/crew";
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
  CrewMemberStatus,
  CrewJoinSource,
  CrewPolicyKey,
  CrewPermissionKey,
  CrewPermissionEffect,
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
  isPresetPosition,
  CREW_POLICY_KEYS,
  CREW_PERMISSION_KEYS,
  CREW_MEMBER_PERMISSIONS,
  CREW_POLICY_PERMISSIONS,
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
  PresetPositionValue,
  CrewPolicyKey,
  CrewPermissionKey,
  CrewPermissionEffect,
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
  productionTemplateLocale?: "en-US" | "zh-CN" | "zh-HK";
  productionKind?: "interactive_film" | "series";
  studioWorkspaceId?: string | null;
  createStudioWorkspace?: { name: string };
  plotTree?: unknown;
  storyboardClipsByNode?: Record<
    string,
    Array<{
      clipId: string;
      title: string;
      order: number;
      durationSeconds: number | null;
    }>
  >;
}

export interface UpdateCrewInput extends Partial<
  Omit<CreateCrewInput, "productionTemplateLocale">
> {
  id: string;
  expectedVersion?: number;
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
  paymentTerms?: import("@repo/shared/crew").TaskPaymentTerms | null;
  taskId?: string;
  recruitmentVisibility?: "public" | "private";
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

export interface UpdatePositionInput extends Partial<
  Omit<CreatePositionInput, "taskId" | "recruitmentVisibility">
> {
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
  lookupBy?: "contact" | "userId";
  positionCategory?: PresetPositionValue;
  account: string;
  policyKeys: CrewPolicyKey[];
  expiresInDays?: number;
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
export type CrewTaskKind =
  | "script"
  | "gameplay"
  | "plot_tree"
  | "art"
  | "storyboard"
  | "voice"
  | "music"
  | "edit"
  | "qa"
  | "other";
export const CREW_TASK_KINDS: CrewTaskKind[] = [
  "script",
  "gameplay",
  "plot_tree",
  "art",
  "storyboard",
  "voice",
  "music",
  "edit",
  "qa",
  "other",
];
export const CREW_TASK_KIND_MESSAGE_KEYS: Record<CrewTaskKind, string> = {
  script: "taskKindScript",
  gameplay: "taskKindGameplay",
  plot_tree: "taskKindPlotTree",
  art: "taskKindArt",
  storyboard: "taskKindStoryboard",
  voice: "taskKindVoice",
  music: "taskKindMusic",
  edit: "taskKindEdit",
  qa: "taskKindQa",
  other: "taskKindOther",
};
export type CrewTaskPriority = "low" | "normal" | "high" | "urgent";
export type CrewTaskViewLayout = "list" | "board";
export type CrewTaskCompletedMode = "all" | "recent" | "hidden";
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
  systemKey: CrewTaskStatus | "backlog" | null;
  position: number;
  archived: boolean;
  version: number;
  /** Present on project configuration payloads so destructive actions can be planned safely. */
  taskCount?: number;
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
  completedMode: CrewTaskCompletedMode;
  showSubIssues: boolean;
  showEmptyGroups: boolean;
  position: number;
  isSystem: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrewTaskKindTemplateDTO {
  id: string;
  kind: CrewTaskKind;
  name: string;
  title: string;
  description: string;
}

export interface CrewTaskProjectDTO {
  views: CrewTaskViewDTO[];
  cycles: CrewTaskCycleDTO[];
  labels: CrewTaskLabelDTO[];
  fields: CrewTaskFieldDTO[];
  workflowStates: CrewTaskWorkflowStateDTO[];
}

export interface CrewTaskAssigneeDTO {
  currency: "CNY" | "USD";
  id: string;
  userId: string;
  crewMemberId: string;
  rewardAmountMinor: number | null;
  assignedAt: string;
}

export interface CrewTaskSubmissionDTO {
  professionalDelivery?:
    | (CrewDeliveryTemplateDTO & { answers: Record<string, string | string[]> })
    | null;
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

export type CrewEarningStatus = "pending" | "posted" | "rejected" | "reversed";
export type CrewEarningSourceType =
  | "task_reward"
  | "contract_compensation"
  | "milestone_bonus"
  | "revenue_share"
  | "discretionary_bonus"
  | "adjustment";

export interface CrewEarningEntryDTO {
  currency: "CNY" | "USD";
  id: string;
  crewId: string;
  crew?: { id: string; name: string } | null;
  revenueDistributionId?: string | null;
  revenueDistribution?: {
    id: string;
    revenueReference: string;
    confirmedAt: string;
    contract: { id: string; filename: string };
    shareBps: number | null;
  } | null;
  crewMemberId: string;
  userId: string;
  sourceType: CrewEarningSourceType;
  task: { id: string; number: number; title: string } | null;
  agreement: { id: string; status: string } | null;
  title: string;
  description: string | null;
  amountMinor: string;
  status: CrewEarningStatus;
  createdByUserId: string;
  approvedByUserId: string | null;
  rejectedByUserId: string | null;
  reversedByUserId: string | null;
  postedAt: string | null;
  rejectedAt: string | null;
  reversedAt: string | null;
  rejectionReason: string | null;
  reversalReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrewEarningEventDTO {
  id: string;
  actorUserId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface CrewEarningDetailDTO extends CrewEarningEntryDTO {
  events: CrewEarningEventDTO[];
}

export interface CrewEarningTrendDTO {
  timezone: "UTC";
  from: string;
  through: string;
  days: Array<{ date: string; amountMinor: string }>;
}

export interface CrewEarningPageDTO {
  items: CrewEarningEntryDTO[];
  nextCursor: string | null;
  summary: {
    byStatus: Record<CrewEarningStatus, { count: number; amountMinor: string }>;
    postedDaily?: CrewEarningTrendDTO;
    postedThisMonthAmountMinor: string;
    postedBySource: Array<{
      sourceType: CrewEarningSourceType;
      count: number;
      amountMinor: string;
    }>;
  };
}

export type CrewPayoutStatus = "pending" | "paid" | "voided";
export type CrewPayoutMethod = "bank_transfer" | "alipay" | "wechat_pay" | "paypal" | "other";

export interface CrewPayoutDTO {
  currency: "CNY" | "USD";
  id: string;
  crewId: string;
  crewMemberId: string;
  userId: string;
  amountMinor: string;
  withholdingAmountMinor: string;
  netAmountMinor: string;
  status: CrewPayoutStatus;
  paymentMethod: CrewPayoutMethod | null;
  paymentReference: string | null;
  paymentProofUrl: string | null;
  note: string | null;
  voidReason: string | null;
  createdByUserId: string;
  paidByUserId: string | null;
  voidedByUserId: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  allocations: Array<{
    id: string;
    amountMinor: string;
    earning: {
      id: string;
      title: string;
      sourceType: CrewEarningSourceType;
      amountMinor: string;
      postedAt: string | null;
      task: { id: string; number: number; title: string } | null;
    };
  }>;
}

export interface CrewPayoutEventDTO {
  id: string;
  actorUserId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface CrewPayoutDetailDTO extends CrewPayoutDTO {
  events: CrewPayoutEventDTO[];
}

export interface CrewPayoutPageDTO {
  items: CrewPayoutDTO[];
  nextCursor: string | null;
  summary: {
    confirmedAmountMinor: string;
    availableAmountMinor: string;
    reservedAmountMinor: string;
    paidAmountMinor: string;
    byStatus: Array<{
      status: CrewPayoutStatus;
      count: number;
      amountMinor: string;
      netAmountMinor: string;
    }>;
  };
}

export interface CrewTaskDTO {
  isRecruiting?: boolean;
  storyboardClipId?: string | null;
  assetCategory?: string;
  id: string;
  crewId: string;
  number: number;
  title: string;
  description: string;
  taskKind?: CrewTaskKind | null;
  status: CrewTaskStatus;
  workflowStateId: string;
  workflowState: CrewTaskWorkflowStateDTO;
  priority: CrewTaskPriority;
  startAt: string | null;
  dueAt: string | null;
  requiredSkills?: string[];
  positionRole?: string | null;
  contractAssetNodeId?: string | null;
  paymentTerms?: TaskPaymentTerms | null;
  rewardCurrency?: "USD" | "CNY";
  rewardUsdMinor?: number | null;
  profitShareBps?: number | null;
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
  episodeId: string | null;
  episode: Pick<CrewEpisodeDTO, "id" | "number" | "title" | "status"> | null;
  deliveryFolder: { id: string; name: string } | null;
  deliveryFields?: Array<{ type: string; required: boolean }> | null;
  labels: CrewTaskLabelDTO[];
  version: number;
  canvasProjectId: string | null;
  canvasDocumentId: string | null;
  canvasHref: string | null;
  createdByUserId: string;
  approvedByUserId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignees: CrewTaskAssigneeDTO[];
  submissions: CrewTaskSubmissionDTO[];
}

export type CrewTaskListItemDTO = Omit<CrewTaskDTO, "submissions">;

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

export interface CrewTaskActivityItemDTO extends CrewTaskTimelineItemDTO {
  task: {
    id: string;
    number: number;
    title: string;
  };
}

export interface CrewTaskActivityPageDTO {
  items: CrewTaskActivityItemDTO[];
  nextCursor: string | null;
}

export interface UpdateCrewTaskInput {
  expectedVersion: number;
  title?: string;
  description?: string;
  priority?: CrewTaskPriority;
  startAt?: string | null;
  dueAt?: string | null;
  requiredSkills?: string[];
  positionRole?: string | null;
  contractAssetNodeId?: string | null;
  paymentTerms?: TaskPaymentTerms | null;
  rewardUsdMinor?: number | null;
  profitShareBps?: number | null;
  estimatePoints?: number | null;
  computeBudgetPoints?: number | null;
  revisionLimit?: number | null;
  cycleId?: string | null;
  episodeId?: string | null;
  parentId?: string | null;
  blockedByTaskIds?: string[];
  customFieldValues?: Array<{ fieldId: string; value: CrewTaskCustomValue }>;
  labelIds?: string[];
  workflowStateId?: string;
  taskKind?: CrewTaskKind | null;
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
  requiredSkills?: string[];
  positionRole?: string | null;
  contractAssetNodeId?: string | null;
  paymentTerms?: TaskPaymentTerms | null;
  rewardCurrency?: "USD" | "CNY";
  rewardUsdMinor?: number | null;
  profitShareBps?: number | null;
  estimatePoints?: number | null;
  computeBudgetPoints?: number | null;
  revisionLimit?: number | null;
  cycleId?: string | null;
  episodeId?: string | null;
  parentId?: string | null;
  blockedByTaskIds?: string[];
  customFieldValues?: Array<{ fieldId: string; value: CrewTaskCustomValue }>;
  labelIds?: string[];
  taskKind?: CrewTaskKind | null;
  assignees: Array<{
    userId: string;
    currency: "CNY" | "USD";
    rewardAmountMinor?: number | null;
  }>;
}

export interface CrewProductionDocumentNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: CrewProductionDocumentNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface CrewProductionDocument {
  type: "doc";
  content: CrewProductionDocumentNode[];
}

export interface CrewProductionPageDTO {
  crewId: string;
  document: CrewProductionDocument;
  version: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type CrewProductionStatus =
  | "backlog"
  | "planned"
  | "in_progress"
  | "completed"
  | "cancelled";

export type CrewProductionDateGranularity = "day" | "month" | "quarter" | "half_year" | "year";

export interface CrewProductionProjectDTO {
  crewId: string;
  status: CrewProductionStatus;
  priority: CrewTaskPriority | null;
  leadMemberId: string | null;
  startDate: string | null;
  startDateGranularity: CrewProductionDateGranularity;
  targetDate: string | null;
  targetDateGranularity: CrewProductionDateGranularity;
  version: number;
  updatedByUserId: string;
  updatedAt: string;
}

export interface CrewProductionResourceDTO {
  id: string;
  crewId: string;
  kind: "link" | "asset";
  title: string;
  url: string | null;
  assetNodeId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  asset: {
    name: string;
    kind: "image" | "video" | "audio" | "document" | "other" | null;
    contentType: string | null;
  } | null;
}

export type CrewProductionUpdateHealth = "on_track" | "at_risk" | "off_track";

export type CrewProductionActivityKind =
  | "comment"
  | "update"
  | "project_created"
  | "properties_changed"
  | "labels_changed"
  | "resource_added"
  | "resource_removed";

export interface CrewProductionActivityDTO {
  id: string;
  crewId: string;
  kind: CrewProductionActivityKind;
  health: CrewProductionUpdateHealth | null;
  content: CrewProductionDocument | null;
  plainText: string;
  progress: number | null;
  payload: Record<string, unknown>;
  createdByUserId: string;
  createdAt: string;
}

export type CrewProductionUpdateDTO = CrewProductionActivityDTO & {
  kind: "update";
  health: CrewProductionUpdateHealth;
};

export interface CrewProductionActivityPageDTO {
  items: CrewProductionActivityDTO[];
  nextCursor: string | null;
}

export type CrewEpisodeStatus =
  | "planned"
  | "in_production"
  | "in_review"
  | "completed"
  | "cancelled";

export type CrewEpisodeDeliveryStatus = "submitted" | "approved" | "rejected";

export interface CrewEpisodeDeliveryDTO {
  id: string;
  episodeId: string;
  versionNumber: number;
  assetNodeId: string;
  status: CrewEpisodeDeliveryStatus;
  note: string;
  reviewNote: string;
  submittedByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  asset: {
    name: string;
    kind: "image" | "video" | "audio" | "document" | "other" | null;
    contentType: string | null;
    sizeBytes: number | null;
    durationSeconds: number | null;
  };
}

export interface CrewEpisodeDTO {
  id: string;
  crewId: string;
  number: number;
  title: string;
  synopsis: string;
  status: CrewEpisodeStatus;
  durationSeconds: number | null;
  plannedReleaseAt: string | null;
  rank: string;
  version: number;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  taskProgress: { total: number; completed: number; pendingReview: number };
  deliveries: CrewEpisodeDeliveryDTO[];
}

export interface CrewProductionOverviewDTO {
  page: CrewProductionPageDTO;
  project: CrewProductionProjectDTO;
  labels: CrewTaskLabelDTO[];
  labelOptions: CrewTaskLabelDTO[];
  resources: CrewProductionResourceDTO[];
  latestUpdate: CrewProductionUpdateDTO | null;
  studioProject: CrewStudioProjectSummaryDTO | null;
  studioWorkspace?: { id: string; name: string } | null;
  capabilities: { manage: boolean; linkWorkspace?: boolean };
}

export interface CrewStudioProjectSummaryDTO {
  id: string;
  name: string;
  workspace: { id: string; name: string };
}

export interface UpdateCrewProductionProjectInput {
  expectedVersion: number;
  status?: CrewProductionStatus;
  priority?: CrewTaskPriority | null;
  leadMemberId?: string | null;
  startDate?: string | null;
  startDateGranularity?: CrewProductionDateGranularity;
  targetDate?: string | null;
  targetDateGranularity?: CrewProductionDateGranularity;
  labelIds?: string[];
}

export interface UpdateCrewProductionProjectResult {
  project: CrewProductionProjectDTO;
  labels: CrewTaskLabelDTO[];
}

export type CreateCrewProductionResourceInput =
  | { kind: "link"; title?: string; url: string }
  | { kind: "asset"; assetNodeId: string; title?: string };

export type CreateCrewProductionActivityInput =
  | { kind: "comment"; content: CrewProductionDocument }
  | {
      kind: "update";
      health: CrewProductionUpdateHealth;
      content: CrewProductionDocument;
      progress?: number | null;
    };

export interface CreateCrewEpisodeInput {
  number?: number;
  title: string;
  synopsis?: string;
  status?: CrewEpisodeStatus;
  durationSeconds?: number | null;
  plannedReleaseAt?: string | null;
}

export interface UpdateCrewEpisodeInput {
  expectedVersion: number;
  number?: number;
  title?: string;
  synopsis?: string;
  status?: CrewEpisodeStatus;
  durationSeconds?: number | null;
  plannedReleaseAt?: string | null;
}

export interface DraftCrewTaskInput {
  prompt: string;
  locale: "en-US" | "zh-CN" | "zh-HK";
  timeZone: string;
  memberHints: Array<{
    userId: string;
    displayName: string;
  }>;
}

export interface CrewTaskDraftDTO {
  title: string;
  description: string;
  priority: CrewTaskPriority;
  startDate: string | null;
  dueDate: string | null;
  paymentTerms?: TaskPaymentTerms | null;
  rewardCurrency?: "USD" | "CNY";
  rewardUsdMinor?: number | null;
  profitShareBps?: number | null;
  estimatePoints: number | null;
  revisionLimit: number | null;
  cycleId: string | null;
  parentId: string | null;
  blockedByTaskIds: string[];
  assigneeUserIds: string[];
  questions: string[];
}

export interface CrewInvitationDTO {
  positionCategory?: PresetPositionValue | null;
  id: string;
  crewId: string;
  inviteeUserId: string;
  invitedByUserId: string;
  policyKeys: CrewPolicyKey[];
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

export interface UpdateCrewMemberInput {
  positions?: Array<{
    categoryKey?: PresetPositionValue | null;
    title?: string | null;
  }>;
  policyKeys?: CrewPolicyKey[];
  permissionOverrides?: Array<{
    permissionKey: CrewPermissionKey;
    effect: CrewPermissionEffect;
  }>;
  expectedVersion: number;
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

export type CrewDeliveryTemplateDTO = {
  categoryId: string;
  version: number;
  definition: {
    name: string;
    prices?: { currency: "USD" | "CNY"; amountMinor: string; unit: string }[];
    fields: {
      key: string;
      label: string;
      instructions: string;
      type: "text" | "attachment";
      required: boolean;
    }[];
  };
};
export type CrewProfessionalDeliveryInput = {
  categoryId: string;
  version: number;
  answers: Record<string, string | string[]>;
};
