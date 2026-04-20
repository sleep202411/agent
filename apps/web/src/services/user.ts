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
  availableForWork?: boolean;
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
