import { appEnv, resolveAssetUrl } from "@/config";
import { api, ApiRequestError, type ApiResponse } from "@/lib/api-client";

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

export type IdentifierKind = "phone" | "email";

export interface NormalizedIdentifier {
  kind: IdentifierKind;
  account: string;
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
  const key = `${encodeURIComponent(name)}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(key))
    ?.slice(key.length);
  if (value === undefined) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
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

function readIsNewUser(envelope: unknown): boolean {
  const root = objectRecord(envelope);
  const payload = objectRecord(root.data);
  const raw = root.isNewUser ?? payload.isNewUser;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") return raw === "true" || raw === "1";
  return false;
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

  return {
    raw: root,
    token,
    isNewUser: readIsNewUser(root),
    user: normalizeUser(wrappedUser ?? (looksLikeUser(payloadRecord) ? payloadRecord : undefined)),
  };
}

export function isEmailIdentifier(identifier: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());
}

/** Loose phone: at least 6 digits after stripping common separators. */
export function isPhoneIdentifier(identifier: string) {
  const digits = identifier.replace(/[^\d]/g, "");
  return digits.length >= 6;
}

export function normalizeIdentifier(raw: string): NormalizedIdentifier | null {
  const account = raw.trim();
  if (!account) return null;
  if (isEmailIdentifier(account)) return { kind: "email", account: account.toLowerCase() };
  if (isPhoneIdentifier(account)) return { kind: "phone", account: account.replace(/[^\d+]/g, "") };
  return null;
}

export function maskIdentifier(identifier: NormalizedIdentifier): string {
  const { account, kind } = identifier;
  if (kind === "email") {
    const [local, domain] = account.split("@");
    if (!domain) return account;
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***@${domain}`;
  }
  if (account.length <= 4) return account;
  return `${account.slice(0, 3)}****${account.slice(-2)}`;
}

/**
 * Unified OTP send: `GET /user/new/getCode?type=phone|email&account=&resetPassword=`.
 * `resetPassword=true` scopes the code to reset and rejects unknown accounts.
 */
async function sendGetCode(
  identifier: NormalizedIdentifier,
  resetPassword: boolean
): Promise<void> {
  await api.get<ApiResponse<unknown>>("/user/new/getCode", {
    params: { type: identifier.kind, account: identifier.account, resetPassword },
    retry: false,
  });
}

/** Sign-in / auto-register OTP (`resetPassword=false`). */
export async function sendLoginCode(identifier: NormalizedIdentifier) {
  await sendGetCode(identifier, false);
}

/** Password-reset OTP (`resetPassword=true`; unknown accounts fail). */
export async function sendResetCode(identifier: NormalizedIdentifier) {
  await sendGetCode(identifier, true);
}

/**
 * OTP login / auto-register: `POST /user/new/login` with type=phone|email.
 * Returns session + `isNewUser` from the envelope.
 */
export async function loginWithCode(
  identifier: NormalizedIdentifier,
  code: string
): Promise<AuthSession> {
  const envelope = await api.postForm<ApiResponse<unknown>>(
    "/user/new/login",
    {
      type: identifier.kind,
      account: identifier.account,
      code: code.trim(),
    },
    { raw: true }
  );
  return sessionFromAuthResult(toAuthResult(envelope));
}

/**
 * Password login for legacy / Account-Security users: `type=pwd`.
 * Never auto-registers.
 */
export async function loginWithPassword(
  identifier: NormalizedIdentifier,
  password: string
): Promise<AuthSession> {
  const envelope = await api.postForm<ApiResponse<unknown>>(
    "/user/new/login",
    {
      type: "pwd",
      account: identifier.account,
      pwd: password,
    },
    { raw: true }
  );
  return sessionFromAuthResult(toAuthResult(envelope), { isNewUser: false });
}

async function sessionFromAuthResult(
  authResult: AuthResult,
  overrides?: { isNewUser?: boolean }
): Promise<AuthSession> {
  if (!authResult.token) {
    throw new Error("Login succeeded, but no session token was returned.");
  }

  let freshUser: AuthUser | undefined;
  try {
    freshUser = await getCurrentUser(authResult.token);
  } catch (error) {
    if (!authResult.user || (error instanceof ApiRequestError && error.status === 401)) throw error;
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
    isNewUser: overrides?.isNewUser ?? authResult.isNewUser === true,
  };
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
  await api.get<unknown>("/user/logout", { retry: false });
}

/** Bind invite code once: `POST /user/recommendationcode/bind` (authed). */
export async function bindInviteCode(recommendationCode: string) {
  await api.postForm<ApiResponse<unknown>>("/user/recommendationcode/bind", {
    recommendationCode: recommendationCode.trim(),
  });
}

/** Set or change password: `POST /user/set/password` (authed). */
export async function setAccountPassword(password: string, oldPassword?: string) {
  const form: Record<string, string> = { password };
  if (oldPassword) form.oldPassword = oldPassword;
  await api.postForm<ApiResponse<unknown>>("/user/set/password", form);
}

/** Update nickname after signup: `POST /user/update/user/info`. */
export async function updateUserNickname(nickName: string) {
  await api.post<ApiResponse<unknown>>("/user/update/user/info", {
    data: { nickName: nickName.trim() },
  });
}

/**
 * Password rule for Account Security and forgot-password reset (matches Java
 * `/user/set/password`): 8–30 chars, letter + digit.
 */
export function isValidAccountPassword(password: string): boolean {
  if (password.length < 8 || password.length > 30) return false;
  return /[A-Za-z]/.test(password) && /\d/.test(password);
}

/** Legacy secondary entry still used by older call sites — maps to `type=pwd`. */
export async function signInWithIdentifier(credentials: SignInCredentials): Promise<AuthSession> {
  const identifier = normalizeIdentifier(credentials.identifier);
  if (!identifier) throw new Error("Enter a valid phone number or email.");
  return loginWithPassword(identifier, credentials.password);
}

/** @deprecated Prefer `sendResetCode` — kept for older call sites. */
export async function sendEmailCode(email: string) {
  await sendGetCode({ kind: "email", account: email }, true);
}

/** @deprecated Prefer `sendResetCode` — kept for older call sites. */
export async function sendPhoneCode(phone: string) {
  await sendGetCode({ kind: "phone", account: phone }, true);
}

/** Send a reset verification code via `/user/new/getCode` (`resetPassword=true`). */
export async function sendVerificationCode(identifier: string) {
  const next = normalizeIdentifier(identifier);
  if (!next) throw new Error("Enter a valid phone number or email.");
  await sendResetCode(next);
}

/**
 * Reset password via OTP on the unified set-password endpoint, then return
 * a signed-in session.
 *
 * `POST /user/set/password` with `type` + `account` + `code` + `password`
 * (unauthenticated reset). Prefer the session token when Java returns one;
 * otherwise sign in with the new password.
 */
export async function resetPasswordWithIdentifier(params: {
  identifier: string;
  code: string;
  password: string;
}): Promise<AuthSession> {
  const identifier = normalizeIdentifier(params.identifier);
  if (!identifier) throw new Error("Enter a valid phone number or email.");

  const envelope = await api.postForm<ApiResponse<unknown>>(
    "/user/set/password",
    {
      type: identifier.kind,
      account: identifier.account,
      code: params.code.trim(),
      password: params.password,
    },
    { raw: true }
  );

  const authResult = toAuthResult(envelope);
  if (authResult.token) {
    return sessionFromAuthResult(authResult, { isNewUser: false });
  }

  return loginWithPassword(identifier, params.password);
}
