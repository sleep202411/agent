/**
 * Typed error codes. The package contains NO user-facing strings — a code
 * plus the raw server message is all it produces, and the host app turns
 * that into copy through its own `t`.
 *
 * Java's `/user/*` auth surface returns `code !== 200` with a localized
 * `msg` and NO machine-readable error code. We have asked for one; until
 * it exists `mapServerMessage` is a STOPGAP, and a stopgap that guesses
 * wrong must never be the last word: the dialog renders the upstream
 * message alongside (or instead of) the mapped copy, so a mis-map costs
 * the user a redundant sentence rather than the only actionable detail
 * they had (root DESIGN.md § Error Toasts).
 */

import type { AuthTranslationKey } from "./keys";

export type AuthErrorCode =
  // Client-side validation, never a round trip.
  | "identifier_required"
  | "identifier_invalid"
  | "code_required"
  | "password_required"
  | "password_too_short"
  | "password_mismatch"
  | "nickname_required"
  | "invite_code_required"
  | "avatar_not_an_image"
  // Client-side throttle on the unauthenticated, SMS-billing send.
  | "resend_cooldown"
  // Mapped from Java's `msg`.
  | "code_incorrect"
  | "code_expired"
  | "credentials_incorrect"
  | "account_not_found"
  | "account_disabled"
  | "rate_limited"
  | "password_rejected"
  | "invite_code_invalid"
  // Transport / contract failures.
  | "network"
  | "invalid_response"
  | "token_missing"
  | "session_unverified"
  | "server_error";

export interface AuthError {
  code: AuthErrorCode;
  /** Java's `msg`, preserved verbatim for display and for reporting. */
  serverMessage?: string;
}

export function authError(code: AuthErrorCode, serverMessage?: string): AuthError {
  return serverMessage ? { code, serverMessage } : { code };
}

/**
 * Which Java call produced a failure.
 *
 * The same words mean different things depending on what was being
 * asked: "密码错误" is *wrong credentials* while signing in and *the new
 * password was rejected* while resetting one; "验证码…" while ASKING for
 * a code is a delivery failure, never "the code you typed is wrong"
 * (nothing has been typed yet). Passing the operation is what turns a
 * pile of substring guesses into a decision.
 */
export type AuthOperation =
  | "send_code"
  | "verify_code"
  | "password_login"
  | "reset_password"
  | "set_password"
  | "bind_invite"
  | "save_profile"
  | "upload_avatar";

interface MessageRule {
  code: AuthErrorCode;
  /**
   * Specificity, not declaration order. The highest-priority match wins;
   * a TIE between two different codes is an ambiguity, and an ambiguous
   * message is not mapped at all (see `mapServerMessage`). Rules can
   * therefore be reordered or added without silently changing an
   * existing verdict — the failure mode of the `if`-cascade this
   * replaced.
   */
  priority: number;
  /** Lowercase; matched with `includes` against the lowercased message. */
  needles: readonly string[];
  /** Operations this rule can possibly explain. Omitted = any of them. */
  only?: readonly AuthOperation[];
}

/** The two calls that submit a code the user typed. */
const CODE_CHECKS = ["verify_code", "reset_password"] as const;

/** Calls that carry a password the user just chose or already had. */
const PASSWORD_CALLS = ["password_login", "reset_password", "set_password"] as const;

const MESSAGE_RULES: readonly MessageRule[] = [
  // 30 — unambiguous, self-describing failures.
  {
    code: "code_expired",
    priority: 30,
    needles: ["过期", "失效", "expired", "expire"],
    only: CODE_CHECKS,
  },
  {
    code: "rate_limited",
    priority: 30,
    // Only words that NAME a throttle. "稍后" / "try again later" used to
    // be here and had to go: 「系统繁忙，请稍后再试」 is Java's generic
    // busy line on every controller, so "later" was reporting an
    // unrelated backend hiccup as rate limiting on every operation —
    // telling the user to slow down when the fix is to try again now.
    // Scoping it to an operation would only have narrowed which calls
    // lie, because that line comes back from all of them; a real throttle
    // always says 频繁 / 太快 / too many. Anything vaguer falls through to
    // `server_error`, which shows Java's own words.
    needles: ["频繁", "太快", "too many", "frequent", "rate limit"],
  },
  {
    code: "invite_code_invalid",
    priority: 30,
    needles: ["邀请码", "推荐码", "invite code", "referral"],
    only: ["bind_invite"],
  },
  // 25 — names a specific subject (the account, the credentials).
  {
    code: "account_not_found",
    priority: 25,
    needles: ["不存在", "未注册", "查无此", "not found", "not exist", "no such user"],
  },
  {
    code: "account_disabled",
    priority: 25,
    needles: ["冻结", "禁用", "封禁", "锁定", "disabled", "locked", "banned"],
  },
  {
    code: "credentials_incorrect",
    priority: 25,
    needles: [
      "密码错误",
      "密码不正确",
      "账号或密码",
      "用户名或密码",
      "wrong password",
      "incorrect password",
      "bad credentials",
    ],
    // Only where a password is being CHECKED. On a reset the same words
    // mean the new password was refused, which rule 10 answers.
    only: ["password_login", "set_password"],
  },
  // 20 — mentions the code, on a call that submitted one.
  {
    code: "code_incorrect",
    priority: 20,
    needles: ["验证码", "verification code", "captcha", "sms code"],
    only: CODE_CHECKS,
  },
  // 10 — mentions a password and nothing more specific did.
  {
    code: "password_rejected",
    priority: 10,
    needles: ["密码", "password"],
    only: PASSWORD_CALLS,
  },
];

/**
 * Best-effort classification of a Java business failure.
 *
 * Deterministic by construction: every rule carries an explicit
 * priority, the highest one wins, and two DIFFERENT codes tied at the
 * top mean the message is ambiguous — which yields `server_error`, i.e.
 * the caller shows Java's own words instead of a coin flip. Same for a
 * message nothing matches. Failing safe is the whole point: the user
 * must always be able to read what the server actually said.
 */
export function mapServerMessage(
  msg: string | undefined,
  operation?: AuthOperation
): AuthErrorCode {
  if (!msg) return "server_error";
  const text = msg.toLowerCase();

  let best: AuthErrorCode | null = null;
  let bestPriority = -1;
  let ambiguous = false;

  for (const rule of MESSAGE_RULES) {
    if (operation && rule.only && !rule.only.includes(operation)) continue;
    if (!rule.needles.some((needle) => text.includes(needle))) continue;
    if (rule.priority > bestPriority) {
      best = rule.code;
      bestPriority = rule.priority;
      ambiguous = false;
    } else if (rule.priority === bestPriority && rule.code !== best) {
      ambiguous = true;
    }
  }

  return best && !ambiguous ? best : "server_error";
}

/**
 * The translation key a code renders as. `server_error` has one too —
 * used only when Java sent no message at all; when it did, the dialog
 * shows that message instead of this key.
 */
export function authErrorTranslationKey(code: AuthErrorCode): AuthTranslationKey {
  return ERROR_KEYS[code];
}

const ERROR_KEYS: Record<AuthErrorCode, AuthTranslationKey> = {
  identifier_required: "errorIdentifierRequired",
  identifier_invalid: "errorIdentifierInvalid",
  code_required: "errorCodeRequired",
  password_required: "errorPasswordRequired",
  password_too_short: "errorPasswordTooShort",
  password_mismatch: "errorPasswordMismatch",
  nickname_required: "errorNicknameRequired",
  invite_code_required: "errorInviteCodeRequired",
  avatar_not_an_image: "errorAvatarNotAnImage",
  resend_cooldown: "errorResendCooldown",
  code_incorrect: "errorCodeIncorrect",
  code_expired: "errorCodeExpired",
  credentials_incorrect: "errorCredentialsIncorrect",
  account_not_found: "errorAccountNotFound",
  account_disabled: "errorAccountDisabled",
  rate_limited: "errorRateLimited",
  password_rejected: "errorPasswordRejected",
  invite_code_invalid: "errorInviteCodeInvalid",
  network: "errorNetwork",
  invalid_response: "errorInvalidResponse",
  token_missing: "errorTokenMissing",
  session_unverified: "errorSessionUnverified",
  server_error: "errorServer",
};
