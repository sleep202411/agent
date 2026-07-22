import { Platform } from "react-native";

import { appEnv, resolveAssetUrl } from "@/config";
import { api, type ApiResponse } from "@/lib/api-client";

import type {
  AuthResult,
  AuthSession,
  AuthToken,
  AuthUser,
  AuthUserLevel,
  RegisterCredentials,
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

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Match studio/web auth: Java may put the token on `data`, on the envelope root, or only in Set-Cookie. */
function readSessionToken(data: unknown, envelope: unknown): AuthToken | undefined {
  const payload = objectRecord(data);
  const root = objectRecord(envelope);
  const payloadInfo = objectRecord(payload.tokenInfo);
  const rootInfo = objectRecord(root.tokenInfo);
  const tokenName =
    stringField(payloadInfo, "tokenName") ??
    stringField(payload, "tokenName") ??
    stringField(rootInfo, "tokenName") ??
    stringField(root, "tokenName") ??
    "satoken";
  const tokenValue =
    stringField(payloadInfo, "tokenValue") ??
    stringField(payload, "tokenValue") ??
    stringField(payload, "token") ??
    stringField(payload, "satoken") ??
    stringField(payload, tokenName) ??
    stringField(rootInfo, "tokenValue") ??
    stringField(root, "tokenValue") ??
    stringField(root, "token") ??
    stringField(root, "satoken") ??
    stringField(root, tokenName) ??
    readCookie(tokenName);

  return tokenValue ? { tokenName, tokenValue } : undefined;
}

/** Web dev runs on localhost — backend Set-Cookie uses prod domains the browser rejects. */
function persistSessionCookie(token: AuthToken) {
  if (Platform.OS !== "web" || typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const maxAge = 60 * 60 * 24 * 30;
  const host = window.location.hostname;
  const domain =
    host === "localhost" || /^[\d.]+$/.test(host)
      ? ""
      : `; Domain=.${host.split(".").slice(-2).join(".")}`;

  document.cookie = `${token.tokenName}=${token.tokenValue}; Path=/${domain}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
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

function toAuthResult(envelope: unknown): AuthResult {
  const root = objectRecord(envelope);
  const payload = root.data ?? root.info ?? root.path ?? root;
  const payloadRecord = objectRecord(payload);
  const wrappedUser = payloadRecord.user ?? payloadRecord.userInfo ?? payloadRecord.info;
  const token = readSessionToken(payload, root);

  if (token) persistSessionCookie(token);

  return {
    raw: root,
    token,
    user: normalizeUser(wrappedUser ?? (looksLikeUser(payloadRecord) ? payloadRecord : undefined)),
  };
}

function isEmailIdentifier(identifier: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
}

export async function emailLogin(params: { email: string; pwd: string }) {
  const envelope = await api.postForm<ApiResponse<unknown>>(
    "/user/email/login",
    {
      email: params.email,
      pwd: params.pwd,
    },
    { raw: true }
  );
  return toAuthResult(envelope);
}

export async function phoneLogin(params: { phone: string; pwd: string }) {
  const envelope = await api.postForm<ApiResponse<unknown>>(
    "/user/login",
    {
      phone: params.phone,
      pwd: params.pwd,
    },
    { raw: true }
  );
  return toAuthResult(envelope);
}

export async function getCurrentUser(token?: AuthToken) {
  const envelope = await api.get<UserInfoEnvelope>("/user/query/user/info", {
    headers: token ? { [token.tokenName]: token.tokenValue } : undefined,
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

export async function emailRegister(params: {
  email: string;
  code: string;
  password: string;
  recommendationCode?: string;
}) {
  const body: Record<string, string> = {
    code: params.code,
    email: params.email,
    password: params.password,
  };
  if (params.recommendationCode) body.recommendationCode = params.recommendationCode;
  const envelope = await api.postForm<ApiResponse<unknown>>("/user/email/regist", body, {
    raw: true,
  });
  return toAuthResult(envelope);
}

export async function phoneRegister(params: {
  phone: string;
  code: string;
  password: string;
  recommendationCode?: string;
}) {
  const body: Record<string, string> = {
    code: params.code,
    password: params.password,
    phone: params.phone,
  };
  if (params.recommendationCode) body.recommendationCode = params.recommendationCode;
  const envelope = await api.postForm<ApiResponse<unknown>>("/user/regist", body, { raw: true });
  return toAuthResult(envelope);
}

/** Send a registration verification code to a phone (CN) or email (global). */
export async function sendVerificationCode(identifier: string) {
  const value = identifier.trim();
  if (isEmailIdentifier(value)) {
    await sendEmailCode(value);
  } else {
    await sendPhoneCode(value);
  }
}

export async function registerWithIdentifier(
  credentials: RegisterCredentials
): Promise<AuthSession> {
  const identifier = credentials.identifier.trim();
  const code = credentials.code.trim();
  const authResult = isEmailIdentifier(identifier)
    ? await emailRegister({
        code,
        email: identifier,
        password: credentials.password,
        recommendationCode: credentials.recommendationCode,
      })
    : await phoneRegister({
        code,
        password: credentials.password,
        phone: identifier,
        recommendationCode: credentials.recommendationCode,
      });

  let freshUser: AuthUser | undefined;
  try {
    freshUser = await getCurrentUser(authResult.token);
  } catch (error) {
    if (!authResult.user) throw error;
  }

  const user = freshUser ?? authResult.user;
  if (!user) {
    throw new Error("Registration succeeded, but user profile was not returned.");
  }

  return {
    region: appEnv.appRegion,
    token: authResult.token,
    updatedAt: new Date().toISOString(),
    user,
  };
}

export async function emailResetPassword(params: {
  email: string;
  code: string;
  password: string;
}) {
  await api.postForm<unknown>("/user/email/reset/password", {
    code: params.code,
    email: params.email,
    password: params.password,
  });
}

export async function phoneResetPassword(params: {
  phone: string;
  code: string;
  password: string;
}) {
  await api.postForm<unknown>("/user/reset/password", {
    code: params.code,
    password: params.password,
    phone: params.phone,
  });
}

/** Reset a password using a verification code — email (global) or phone (CN). */
export async function resetPasswordWithIdentifier(params: {
  identifier: string;
  code: string;
  password: string;
}) {
  const identifier = params.identifier.trim();
  const code = params.code.trim();
  if (isEmailIdentifier(identifier)) {
    await emailResetPassword({ code, email: identifier, password: params.password });
  } else {
    await phoneResetPassword({ code, password: params.password, phone: identifier });
  }
}
