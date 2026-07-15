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
  CrewMemberVia,
  CrewApplicationDTO,
  CrewApplicationStatus,
  EpisodeDTO,
  EpisodeStatus,
  EpisodeAssignmentDTO,
  AssignmentStatus,
  EpisodeActivityDTO,
  EpisodeActivityType,
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
  AddMemberInput,
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
  useCrewApplications,
  useRejectApplication,
} from "./use-applications";

export {
  useAddCrewMember,
  useCrewMembers,
  useRemoveMember,
  useTransferCrewOwner,
  useUpdateMember,
} from "./use-members";
