/**
 * User service — auth, profile, credits
 *
 * All functions use the unified api client. Response parsing (code check,
 * data/info/path extraction) is handled by the client automatically.
 */
import { api } from "@/src/lib/api";

// ─── Types ────────────────────────────────────────────

export interface UserInfo {
  id?: number | string;
  nickName?: string;
  userName?: string;
  name?: string;
  phone?: string;
  email?: string;
  contact?: string;
  avatar?: string;
  headImg?: string;
  description?: string;
  other?: string;
  userLevel?: string;
  authStatus?: number;
  scoreBalance?: number;
  expireTime?: string;
  createTime?: string;
  coverImage?: string;
  /** Whether the user is open to job offers / freelance work. */
  availableForWork?: boolean;
  /** Education history. Wire format is a JSON-encoded `EducationEntry[]`
   *  string. Parse via `parseEducation()` before rendering / editing. */
  study?: string;
}

/**
 * Single education entry. `endDate` left empty means "still studying".
 * Dates are free-form `YYYY-MM` strings — backend stores raw, frontend
 * displays as-is so we don't pin to a calendar locale.
 */
export interface EducationEntry {
  schoolName: string;
  major: string;
  startDate: string;
  /** Optional. Empty / missing ⇒ ongoing. */
  endDate?: string;
}

/** Parse the on-wire `study` string into structured entries. Tolerant of:
 *  - empty / null
 *  - already-structured (legacy free-text rows are returned as
 *    `schoolName`-only entries so old data still renders something)
 *  - malformed JSON (returns []) */
export function parseEducation(study: string | null | undefined): EducationEntry[] {
  if (!study || typeof study !== "string") return [];
  const trimmed = study.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .map((e) => ({
          schoolName: typeof e.schoolName === "string" ? e.schoolName : "",
          major: typeof e.major === "string" ? e.major : "",
          startDate: typeof e.startDate === "string" ? e.startDate : "",
          endDate: typeof e.endDate === "string" ? e.endDate : "",
        }));
    } catch {
      return [];
    }
  }
  // Legacy free-text rows — keep them visible by mapping each non-empty
  // line into a school-name-only entry.
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ schoolName: line, major: "", startDate: "", endDate: "" }));
}

/** Serialize back to the on-wire `study` string. Drops fully-empty entries. */
export function serializeEducation(entries: EducationEntry[]): string {
  const cleaned = entries
    .map((e) => ({
      schoolName: e.schoolName.trim(),
      major: e.major.trim(),
      startDate: e.startDate.trim(),
      endDate: (e.endDate ?? "").trim(),
    }))
    .filter((e) => e.schoolName || e.major || e.startDate || e.endDate);
  return cleaned.length ? JSON.stringify(cleaned) : "";
}

export interface CreditInfo {
  scoreBalance?: number;
  score?: number;
  credits?: number;
  integral?: number;
  value?: number;
}

// ─── Auth ─────────────────────────────────────────────

export const login = (email: string, pwd: string) =>
  api.postForm("/user/email/login", { email, pwd });

export const logout = () => api.post("/user/logout");

export const sendEmailCode = (email: string) =>
  api.get(`/user/email/getCode`, { params: { email } });

export const register = (email: string, pwd: string, code: string, recommendationCode?: string) =>
  api.postForm("/user/email/regist", {
    email,
    pwd,
    code,
    ...(recommendationCode ? { recommendationCode } : {}),
  });

export const resetPassword = (email: string, pwd: string, code: string) =>
  api.postForm("/user/email/reset/password", { email, pwd, code });

// ─── Profile ──────────────────────────────────────────

export const getUserInfo = () => api.get<UserInfo>("/user/query/user/info");

export const updateUserInfo = (data: {
  nickName?: string;
  contact?: string;
  description?: string;
  other?: string;
  /** Education history (free-form multi-line text). */
  study?: string;
  /** Job-seeking toggle. true = open / show in talent market filters. */
  availableForWork?: boolean;
}) => api.post("/user/update/user/info", { data });

export const uploadAvatar = (file: File) => api.upload<string>("/user/uploadAratar", file);

export const uploadCover = (file: File) => api.upload<string>("/content/user/uploadCover", file);

export const getRecommendationCode = () => api.get<string>("/user/recommendationcode");

// ─── Credits ──────────────────────────────────────────

export const getCredits = async (): Promise<number> => {
  const data = await api.post<CreditInfo>("/api/ai/record/myscore");
  const value = Number(
    data.scoreBalance ?? data.score ?? data.credits ?? data.integral ?? data.value ?? 0
  );
  return Number.isFinite(value) ? value : 0;
};
