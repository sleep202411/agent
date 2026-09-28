/**
 * User certification-level application — Java `/user/levels/*`.
 * See `fizzdragon/docs/user-level-apply-api.md`.
 */
import { api } from "@/src/lib/api";

export interface UserLevelOption {
  id: number;
  name: string;
  description?: string | null;
  imagePath?: string | null;
  type?: number;
  remark?: string | null;
}

export type UserLevelApplicationStatus = 0 | 1 | 2 | 3;

export interface UserLevelApplication {
  id: number;
  levelId: number;
  levelName?: string;
  crewName: string;
  crewLink: string;
  ipName: string;
  ipLink: string;
  attachmentUrl?: string | null;
  extraInfo?: string | null;
  status: UserLevelApplicationStatus;
  adminRemark?: string | null;
  createTime?: string;
  updateTime?: string;
}

export interface SubmitUserLevelApplyInput {
  levelId: number;
  /** Required: the selected crew name and link. IP fields may be empty. */
  crewName: string;
  crewLink: string;
  ipName: string;
  ipLink: string;
  attachmentUrl?: string;
  extraInfo?: string;
}

export const USER_LEVEL_APPLY_STATUS = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
  CANCELLED: 3,
} as const;

export const USER_LEVEL_APPLY_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.pdf,.zip,.doc,.docx,image/jpeg,image/png,image/gif,application/pdf,application/zip,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Available certification levels for the apply dropdown. */
export function listUserLevelOptions() {
  return api.get<UserLevelOption[]>("/user/levels/options");
}

/**
 * Optional attachment upload. Returns the OSS path to send as `attachmentUrl`.
 * Envelope exposes both `path` and `attachmentUrl`; api-client unwraps `path`.
 */
export function uploadUserLevelApplyAttachment(file: File) {
  return api.upload<string>("/user/levels/apply/upload", file, "file");
}

export function submitUserLevelApply(input: SubmitUserLevelApplyInput) {
  return api.post("/user/levels/apply", { data: input });
}

export function listMyUserLevelApplications(status?: UserLevelApplicationStatus) {
  return api.get<UserLevelApplication[]>("/user/levels/apply/mine", {
    params: status === undefined ? undefined : { status },
  });
}

export function cancelUserLevelApplication(applicationId: number) {
  return api.post("/user/levels/apply/cancel", {
    params: { id: applicationId },
  });
}
