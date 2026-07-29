/**
 * Crews feature data layer — single import surface for routes / components.
 *
 * All consumers import from here. Internal hook files own the actual
 * fetcher + cache-key wiring; this barrel keeps consumers stable when
 * the layout under `_hooks/` evolves.
 */

"use client";

export { crewKeys } from "./shared";
export { CrewApiError, crewApi } from "./api";

export type {
  CrewDTO,
  CrewListingStatus,
  CrewPositionDTO,
  CrewPositionStatus,
  CrewMemberDTO,
  CrewMemberPageDTO,
  CrewMembershipDTO,
  CrewMemberVia,
  CrewApplicationDTO,
  CrewApplicationStatus,
  PresetPositionValue,
  WorkMode,
  EmploymentType,
  ExperienceLevel,
  SalaryPeriod,
  SalaryInput,
  CurrencyCode,
  CreateCrewInput,
  UpdateCrewInput,
  UpdateCrewListingInput,
  CreatePositionInput,
  UpdatePositionInput,
  ApplyInput,
  CreateCrewInvitationInput,
  CrewTaskDTO,
  CrewTaskListItemDTO,
  CrewTaskPageDTO,
  CrewTaskOptionDTO,
  CrewTaskOptionPageDTO,
  CrewTaskSummaryDTO,
  CrewTaskStatus,
  CrewTaskPriority,
  CrewTaskViewLayout,
  CrewTaskViewScope,
  CrewTaskViewGroup,
  CrewTaskViewDTO,
  CrewTaskProjectDTO,
  CrewTaskWorkflowStateDTO,
  CrewTaskCycleDTO,
  CrewTaskLabelDTO,
  CrewTaskFieldDTO,
  CrewTaskFieldType,
  CrewTaskCustomValue,
  CrewTaskReferenceDTO,
  CrewSettlementItemDTO,
  CrewTaskTimelineItemDTO,
  CrewTaskTimelinePageDTO,
  CrewTaskMentionDTO,
  CrewTaskCommentAttachmentInput,
  UpdateCrewTaskInput,
  CreateCrewTaskCommentInput,
  UpdateCrewTaskCommentInput,
  CreateCrewTaskInput,
  CrewInvitationDTO,
  CrewInvitationPageDTO,
  CrewAgreementDTO,
  CrewAgreementSigningSession,
  CrewAgreementStatus,
  CrewAgreementArchiveStatus,
  CrewAgreementView,
  CrewAgreementsResponse,
  CreateCrewAgreementInput,
} from "./types";
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
} from "./types";

export { useCrewList, useMyCrews } from "./use-crew-list";
export {
  useCrewDetail,
  useCreateCrew,
  useDeleteCrew,
  useUpdateCrew,
  useUpdateCrewListing,
} from "./use-crew-detail";

export {
  useCrewPositions,
  useCreatePosition,
  useDeletePosition,
  useUpdatePosition,
} from "./use-positions";

export {
  useApplyToPosition,
  useApproveApplication,
  useCrewApplication,
  useCrewApplications,
  useRejectApplication,
} from "./use-applications";

export {
  useCrewMembers,
  useCrewMembership,
  useRemoveMember,
  useTransferCrewOwner,
  useUpdateMember,
} from "./use-members";
export {
  useCrewTaskProject,
  useCrewTaskView,
  useCrewTaskOptions,
  useCrewTaskSummary,
  useCrewTask,
  useCrewTaskTimeline,
  useCreateCrewTask,
  useUpdateCrewTask,
  useCreateCrewTaskComment,
  useUpdateCrewTaskComment,
  useDeleteCrewTaskComment,
  useSubmitCrewTask,
  useReviewCrewTask,
  useCrewSettlements,
  useSettleCrewItem,
  useCreateCrewTaskView,
  useUpdateCrewTaskView,
  useDeleteCrewTaskView,
  useCreateCrewTaskWorkflowState,
  useUpdateCrewTaskWorkflowState,
  useReorderCrewTaskWorkflowStates,
  useDeleteCrewTaskWorkflowState,
  useCreateCrewTaskCycle,
  useUpdateCrewTaskCycle,
  useDeleteCrewTaskCycle,
  useCreateCrewTaskLabel,
  useUpdateCrewTaskLabel,
  useDeleteCrewTaskLabel,
  useCreateCrewTaskField,
  useUpdateCrewTaskField,
  useDeleteCrewTaskField,
  useReorderCrewTask,
  useBatchUpdateCrewTasks,
} from "./use-tasks";
export type { SaveCrewTaskViewInput } from "./use-tasks";
export {
  useCrewInvitations,
  useMyCrewInvitation,
  useInviteCrewMember,
  useAcceptCrewInvitation,
  useDeclineCrewInvitation,
  useRevokeCrewInvitation,
} from "./use-invitations";
export {
  useCrewAgreements,
  useCreateCrewAgreement,
  useCreateCrewAgreementSigningSession,
  useSyncCrewAgreement,
  useRetryCrewAgreementSend,
  useRetryCrewAgreementArchive,
} from "./use-agreements";
