import { appEnv, resolveAssetUrl } from "@/config";
import { api, type ApiResponse } from "@/lib/api-client";

import type {
  AuthResult,
  AuthSession,
  AuthToken,
  AuthUser,
  AuthUserLevel,
  SignInCredentials,
} from "./types";

interface UserInfoEnvelope extends ApiResponse<unknown> {
  info?: AuthUser;
  level?: AuthUserLevel[];
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function looksLikeUser(record: Record<string, unknown>) {
  return (
    "userId" in record ||
    "id" in record ||
    "phone" in record ||
    "email" in record ||
    "nickname" in record ||
    "nickName" in record
  );
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function normalizeToken(data: Record<string, unknown>): AuthToken | undefined {
  const tokenInfo = (data.tokenInfo ?? {}) as Record<string, unknown>;
  const tokenName = stringField(tokenInfo, "tokenName") ?? "satoken";
  const tokenValue =
    stringField(tokenInfo, "tokenValue") ??
    stringField(data, "token") ??
    stringField(data, "satoken") ??
    stringField(data, tokenName) ??
    readCookie(tokenName);

  return tokenValue ? { tokenName, tokenValue } : undefined;
}

function normalizeUser(raw: unknown): AuthUser | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const user = raw as AuthUser;
  const avatarBase = appEnv.assets.userBaseUrl || appEnv.assets.ossBaseUrl;
  return {
    ...user,
    headImgUrl: resolveAssetUrl(user.headImg ?? user.avatar ?? "", avatarBase) || user.headImgUrl,
    bannerUrl: resolveAssetUrl(user.banner ?? "", appEnv.assets.bannerBaseUrl) || user.bannerUrl,
  };
}

function toAuthResult(data: unknown): AuthResult {
  const record = (data ?? {}) as Record<string, unknown>;
  const wrappedUser = record.user ?? record.userInfo ?? record.info;
  return {
    raw: record,
    token: normalizeToken(record),
    user: normalizeUser(wrappedUser ?? (looksLikeUser(record) ? record : undefined)),
  };
}

function isEmailIdentifier(identifier: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
}

export async function emailLogin(params: { email: string; pwd: string }) {
  const data = await api.postForm<unknown>("/user/email/login", {
    email: params.email,
    pwd: params.pwd,
  });
  return toAuthResult(data);
}

export async function phoneLogin(params: { phone: string; pwd: string }) {
  const data = await api.postForm<unknown>("/user/login", {
    phone: params.phone,
    pwd: params.pwd,
  });
  return toAuthResult(data);
}

export async function getCurrentUser(token?: AuthToken) {
  const envelope = await api.get<UserInfoEnvelope>("/user/query/user/info", {
    headers: token ? { Authorization: `Bearer ${token.tokenValue}` } : undefined,
    raw: true,
  });
  const rawLevels = Array.isArray(envelope.level) ? envelope.level : [];
  const user = normalizeUser(envelope.info ?? envelope.data);
  if (!user) return undefined;

  return {
    ...user,
    levels: rawLevels.map((level) => ({
      ...level,
      iconUrl: resolveAssetUrl(level.imagePath ?? "", appEnv.assets.staticBaseUrl),
    })),
  };
}

export async function logout() {
  await api.get<unknown>("/user/logout");
}

export async function sendEmailCode(email: string) {
  await api.get<ApiResponse<unknown>>("/user/email/getCode", { params: { email } });
}

export async function sendPhoneCode(phone: string) {
  await api.get<ApiResponse<unknown>>("/user/getCode", { params: { phone } });
}

export async function signInWithIdentifier(credentials: SignInCredentials): Promise<AuthSession> {
  const identifier = credentials.identifier.trim();
  const password = credentials.password;
  const authResult = isEmailIdentifier(identifier)
    ? await emailLogin({ email: identifier, pwd: password })
    : await phoneLogin({ phone: identifier, pwd: password });

  let freshUser: AuthUser | undefined;
  try {
    freshUser = await getCurrentUser(authResult.token);
  } catch (error) {
    if (!authResult.user) throw error;
  }

  const user = freshUser ?? authResult.user;

  if (!user) {
    throw new Error("Login succeeded, but user profile was not returned.");
  }

  return {
    region: appEnv.appRegion,
    token: authResult.token,
    updatedAt: new Date().toISOString(),
    user,
  };
}
