/**
 * User service — profile, credits.
 *
 * All functions use the unified api client. Response parsing (code check,
 * data/info/path extraction) is handled by the client automatically.
 *
 * No auth here: signing in is `@repo/auth-flow`'s (Java's `/user/new/*`
 * contract) and signing out is `src/lib/auth/api.ts`. The `/user/email/*`
 * login / register / reset wrappers that used to sit above `Profile` were
 * deleted with their last caller — the endpoints are superseded.
 */
import { api } from "@/src/lib/api";
import { env } from "@/src/env";

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
  /** Cover/banner image. Wire field is `banner` (Java side). Persisted
   *  via `updateUserInfo({ banner })`; uploaded via `uploadBanner()`. */
  banner?: string;
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

// ─── Profile ──────────────────────────────────────────

/**
 * Resolve a backend-relative asset path against an OSS base URL. Pass
 * absolute URLs through unchanged; return undefined for empty input
 * so consumers can render fallbacks.
 */
export function resolveAssetUrl(path: string | null | undefined, base: string): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("http")) return path;
  return base ? `${base}/${path}` : undefined;
}

/** Certification / FD-level entry returned alongside the user info
 *  envelope. Same shape as the talent-market `level` rows so the two
 *  surfaces can render the same chip component. `iconUrl` is the
 *  resolved badge image URL (STATIC_BASE_URL + imagePath); empty
 *  string when the level has no badge. */
export interface UserCertLevel {
  id: number;
  name: string;
  description?: string | null;
  imagePath?: string | null;
  iconUrl: string;
  type?: number;
  remark?: string | null;
  content?: string | null;
}

export interface UserInfoResolved extends UserInfo {
  /** Full URL for the avatar (USER_BASE_URL || OSS_BASE_URL + headImg/avatar). */
  headImgUrl?: string;
  /** Full URL for the cover/banner image (BANNER_BASE_URL + banner). */
  bannerUrl?: string;
  /** Certification levels (FD-IV etc.). Empty array if backend doesn't
   *  return any — callers can render conditionally. */
  levels?: UserCertLevel[];
}

interface UserCertLevelWire {
  id: number;
  name: string;
  description?: string | null;
  imagePath?: string | null;
  type?: number;
  remark?: string | null;
  content?: string | null;
}

interface UserInfoEnvelope {
  info?: UserInfo;
  level?: UserCertLevelWire[];
}

export const getUserInfo = async (): Promise<UserInfoResolved> => {
  // Backend response shape is `{ code, msg, info, level }`. The shared
  // api-client unwrap defaults to `body.data ?? body.info ?? ...` which
  // would silently drop `level`. Use `raw: true` to keep the full
  // envelope so we can surface both info and level downstream.
  const env_ = await api.get<UserInfoEnvelope>("/user/query/user/info", { raw: true });
  const info = env_?.info ?? ({} as UserInfo);
  const rawLevels = Array.isArray(env_?.level) ? env_.level : [];
  const avatarBase = env.USER_BASE_URL || env.OSS_BASE_URL;
  return {
    ...info,
    headImgUrl: resolveAssetUrl(info.headImg ?? info.avatar, avatarBase),
    bannerUrl: resolveAssetUrl(info.banner, env.BANNER_BASE_URL),
    levels: rawLevels.map((l) => ({
      ...l,
      iconUrl: resolveAssetUrl(l.imagePath, env.STATIC_BASE_URL) ?? "",
    })),
  };
};

export const updateUserInfo = (data: {
  nickName?: string;
  contact?: string;
  description?: string;
  other?: string;
  /** Education history (free-form multi-line text). */
  study?: string;
  /** Job-seeking toggle. true = open / show in talent market filters. */
  availableForWork?: boolean;
  /** Cover/banner image path (returned by `uploadBanner`). */
  banner?: string;
}) => api.post("/user/update/user/info", { data });

export const uploadAvatar = (file: File) => api.upload<string>("/user/uploadAratar", file);

export const uploadBanner = (file: File) => api.upload<string>("/project/uploadBanner", file);

export const getRecommendationCode = () => api.get<string>("/user/recommendationcode");

// ─── Credits ──────────────────────────────────────────

export const getCredits = async (): Promise<number> => {
  const data = await api.post<CreditInfo>("/api/ai/record/myscore");
  const value = Number(
    data.scoreBalance ?? data.score ?? data.credits ?? data.integral ?? data.value ?? 0
  );
  return Number.isFinite(value) ? value : 0;
};
