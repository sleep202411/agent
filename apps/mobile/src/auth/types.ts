import type { AppRegion } from "@/config";

export interface AuthUserLevel {
  id?: number | string;
  name?: string;
  description?: string | null;
  imagePath?: string | null;
  iconUrl?: string;
  type?: number;
  [key: string]: unknown;
}

export interface AuthUser {
  id?: number | string;
  userId?: number | string;
  nickName?: string;
  nickname?: string;
  userName?: string;
  name?: string;
  phone?: string;
  email?: string;
  avatar?: string;
  authStatus?: number | string;
  headImg?: string;
  headImgUrl?: string;
  banner?: string;
  bannerUrl?: string;
  scoreBalance?: number;
  userLevel?: string;
  levels?: AuthUserLevel[];
  /** Present when the account already has a real password (not null / `--`). */
  hasPassword?: boolean;
  [key: string]: unknown;
}

export interface AuthToken {
  tokenName: string;
  tokenValue: string;
}

export interface AuthSession {
  region: AppRegion;
  token?: AuthToken;
  updatedAt: string;
  user: AuthUser;
  /** True only for the OTP path that just auto-registered. Drives onboarding. */
  isNewUser?: boolean;
}

export type AuthStatus = "hydrating" | "anonymous" | "authenticated" | "submitting" | "error";

export interface AuthState {
  error?: string;
  session?: AuthSession;
  status: AuthStatus;
  user?: AuthUser;
}

export interface SignInCredentials {
  identifier: string;
  password: string;
}

export interface AuthResult {
  raw: unknown;
  token?: AuthToken;
  user?: AuthUser;
  isNewUser?: boolean;
}
