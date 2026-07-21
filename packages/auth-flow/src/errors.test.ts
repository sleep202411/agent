import { describe, expect, it } from "vitest";

import { AUTH_TRANSLATION_KEYS } from "./keys";
import { authErrorTranslationKey, mapServerMessage, type AuthErrorCode } from "./errors";

describe("mapServerMessage", () => {
  it("maps the Chinese messages Java actually returns", () => {
    expect(mapServerMessage("验证码错误", "verify_code")).toBe("code_incorrect");
    expect(mapServerMessage("验证码已过期，请重新获取", "verify_code")).toBe("code_expired");
    expect(mapServerMessage("操作过于频繁，请稍后再试", "send_code")).toBe("rate_limited");
    expect(mapServerMessage("用户不存在", "password_login")).toBe("account_not_found");
    expect(mapServerMessage("账号或密码错误", "password_login")).toBe("credentials_incorrect");
    expect(mapServerMessage("该账号已被冻结", "password_login")).toBe("account_disabled");
    expect(mapServerMessage("邀请码无效", "bind_invite")).toBe("invite_code_invalid");
  });

  it("prefers the more specific expiry match over the generic code match", () => {
    expect(mapServerMessage("验证码已失效", "verify_code")).toBe("code_expired");
  });

  it("maps the English equivalents too (Java answers accept-language)", () => {
    expect(mapServerMessage("Verification code is incorrect", "verify_code")).toBe(
      "code_incorrect"
    );
    expect(mapServerMessage("Too many requests", "send_code")).toBe("rate_limited");
    expect(mapServerMessage("User not found", "password_login")).toBe("account_not_found");
  });

  it("falls through to server_error so the raw message gets shown", () => {
    expect(mapServerMessage("系统繁忙", "verify_code")).toBe("server_error");
    expect(mapServerMessage(undefined)).toBe("server_error");
    expect(mapServerMessage("")).toBe("server_error");
  });

  it("does not read Java's generic busy line as a throttle", () => {
    // 「系统繁忙，请稍后再试」 comes back from every controller on any
    // backend hiccup. Mapping "later" to rate limiting told the user to
    // slow down — on every operation — when the fix is to try again now,
    // and buried the only sentence that said what actually happened.
    for (const operation of [
      "send_code",
      "verify_code",
      "password_login",
      "bind_invite",
    ] as const) {
      expect(mapServerMessage("系统繁忙，请稍后再试", operation)).toBe("server_error");
      expect(mapServerMessage("Service busy, please try again later", operation)).toBe(
        "server_error"
      );
    }
    // A real throttle names itself, and still maps.
    expect(mapServerMessage("请求过于频繁，请稍后再试", "send_code")).toBe("rate_limited");
    expect(mapServerMessage("Too many requests, try again later", "send_code")).toBe(
      "rate_limited"
    );
  });

  it("is not order-dependent: priority alone decides between matches", () => {
    // "验证码已过期" matches BOTH the expiry rule and the generic code
    // rule; the verdict must not depend on where either sits in the table.
    expect(mapServerMessage("已过期的验证码", "verify_code")).toBe("code_expired");
    expect(mapServerMessage("验证码已过期", "reset_password")).toBe("code_expired");
  });

  describe("the operation disambiguates", () => {
    it("reads a password complaint as credentials when signing in", () => {
      expect(mapServerMessage("密码错误", "password_login")).toBe("credentials_incorrect");
    });

    it("reads the same words as a rejected NEW password when resetting", () => {
      // Nothing is being checked against here — the user is choosing.
      expect(mapServerMessage("密码错误", "reset_password")).toBe("password_rejected");
      expect(mapServerMessage("密码长度不足", "reset_password")).toBe("password_rejected");
    });

    it("never claims a typed code is wrong on the call that ASKS for one", () => {
      // Nothing has been typed yet, so this is a delivery failure and the
      // user must read Java's own words about it.
      expect(mapServerMessage("验证码发送失败", "send_code")).toBe("server_error");
      expect(mapServerMessage("验证码已过期", "send_code")).toBe("server_error");
      // A send CAN legitimately be throttled, and that still maps.
      expect(mapServerMessage("验证码发送过于频繁", "send_code")).toBe("rate_limited");
    });

    it("does not blame the invite code outside the invite call", () => {
      expect(mapServerMessage("邀请码无效", "verify_code")).toBe("server_error");
    });

    it("treats a password complaint on an unrelated call as unmapped", () => {
      expect(mapServerMessage("密码错误", "send_code")).toBe("server_error");
      expect(mapServerMessage("密码错误", "bind_invite")).toBe("server_error");
    });
  });

  describe("ambiguity fails safe", () => {
    it("refuses to pick between two equally specific readings", () => {
      // Both "not found" and "disabled" fire, at the same specificity —
      // guessing would show the user a confidently wrong sentence.
      expect(mapServerMessage("账号不存在或已被禁用", "password_login")).toBe("server_error");
    });

    it("still resolves when one reading is strictly more specific", () => {
      // Three rules fire here — expiry (30), "不存在" (25) and the generic
      // code rule (20) — but only one sits at the top, so there is nothing
      // to be ambiguous about.
      expect(mapServerMessage("验证码不存在或已过期", "verify_code")).toBe("code_expired");
      expect(mapServerMessage("验证码已过期，请重新发送", "verify_code")).toBe("code_expired");
    });
  });
});

describe("authErrorTranslationKey", () => {
  const codes: AuthErrorCode[] = [
    "identifier_required",
    "identifier_invalid",
    "code_required",
    "password_required",
    "password_too_short",
    "password_mismatch",
    "nickname_required",
    "invite_code_required",
    "avatar_not_an_image",
    "resend_cooldown",
    "code_incorrect",
    "code_expired",
    "credentials_incorrect",
    "account_not_found",
    "account_disabled",
    "rate_limited",
    "password_rejected",
    "invite_code_invalid",
    "network",
    "invalid_response",
    "token_missing",
    "session_unverified",
    "server_error",
  ];

  it("resolves every code to a key that is on the published key list", () => {
    for (const code of codes) {
      expect(AUTH_TRANSLATION_KEYS).toContain(authErrorTranslationKey(code));
    }
  });

  it("keeps the key list free of duplicates", () => {
    expect(new Set(AUTH_TRANSLATION_KEYS).size).toBe(AUTH_TRANSLATION_KEYS.length);
  });
});
