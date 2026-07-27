import { describe, expect, it } from "vitest";

import { AuthClient, AuthRequestError, toAuthError } from "./client";
import {
  AuthTransportError,
  type AuthRequest,
  type AuthResponse,
  type AuthTransport,
} from "./transport";
import type { NormalizedIdentifier } from "./types";

const PHONE: NormalizedIdentifier = { kind: "phone", account: "13800138000" };
const EMAIL: NormalizedIdentifier = { kind: "email", account: "isaac@fizzdragon.com" };

function fakeTransport(respond: (request: AuthRequest) => AuthResponse) {
  const sent: AuthRequest[] = [];
  const transport: AuthTransport = {
    async request(input) {
      sent.push(input);
      return respond(input);
    },
  };
  return { transport, sent };
}

const ok = (body: Record<string, unknown>): AuthResponse => ({ status: 200, body });

describe("AuthClient — the Java contract", () => {
  it("asks for a code with type + account", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200 }));
    await new AuthClient(transport).sendCode(PHONE);
    expect(sent[0]).toEqual({
      method: "GET",
      path: "/user/new/getCode",
      query: { type: "phone", account: "13800138000" },
    });
  });

  it("logs in with a code and reads the session out of the envelope", async () => {
    const { transport, sent } = fakeTransport(() =>
      ok({ code: 200, msg: "ok", token: "tok", isNewUser: true, userId: 7 })
    );
    const session = await new AuthClient(transport).loginWithCode(EMAIL, "123456");
    expect(sent[0]).toEqual({
      method: "POST",
      path: "/user/new/login",
      form: { type: "email", account: "isaac@fizzdragon.com", code: "123456" },
    });
    expect(session).toEqual({
      token: { name: "satoken", value: "tok" },
      isNewUser: true,
      userId: "7",
      identifier: EMAIL,
    });
  });

  it("uses type=pwd on the legacy password path regardless of account kind", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200, token: "tok" }));
    const session = await new AuthClient(transport).loginWithPassword(PHONE, "hunter2");
    expect(sent[0]?.form).toEqual({ type: "pwd", account: "13800138000", pwd: "hunter2" });
    // Absent `isNewUser` must never trigger onboarding on a legacy account.
    expect(session.isNewUser).toBe(false);
  });

  it("rejects a code-200 login that carries no token", async () => {
    const { transport } = fakeTransport(() => ok({ code: 200, msg: "ok" }));
    await expect(new AuthClient(transport).loginWithCode(PHONE, "123456")).rejects.toMatchObject({
      error: { code: "token_missing" },
    });
  });

  it("maps a business failure and keeps the server message verbatim", async () => {
    const { transport } = fakeTransport(() => ok({ code: 500, msg: "验证码错误" }));
    await expect(new AuthClient(transport).loginWithCode(PHONE, "000000")).rejects.toMatchObject({
      error: { code: "code_incorrect", serverMessage: "验证码错误" },
    });
  });

  it("classifies the same message by which call produced it", async () => {
    const { transport } = fakeTransport(() => ok({ code: 500, msg: "密码错误" }));
    const client = new AuthClient(transport);
    await expect(client.loginWithPassword(PHONE, "nope")).rejects.toMatchObject({
      error: { code: "credentials_incorrect", serverMessage: "密码错误" },
    });
    await expect(client.resetPassword(PHONE, "123456", "short")).rejects.toMatchObject({
      error: { code: "password_rejected", serverMessage: "密码错误" },
    });
  });

  it("reports a transport failure as a network error", async () => {
    const transport: AuthTransport = {
      request: () => Promise.reject(new TypeError("Failed to fetch")),
    };
    await expect(new AuthClient(transport).sendCode(PHONE)).rejects.toMatchObject({
      error: { code: "network" },
    });
  });

  it("keeps an unreadable response distinct from an unreachable server", async () => {
    // A gateway HTML page is not "check your connection" — the connection
    // worked. Telling the user otherwise sends them after the wrong bug.
    const transport: AuthTransport = {
      request: () => Promise.reject(new AuthTransportError("invalid_response", 502)),
    };
    await expect(new AuthClient(transport).sendCode(PHONE)).rejects.toMatchObject({
      error: { code: "invalid_response" },
    });
  });

  it("refuses a transport that hands back something other than an envelope", async () => {
    // A hand-written transport can return anything; the contract is
    // enforced rather than trusted, so a bodyless 200 can never read as
    // "signed in, but no token".
    for (const body of [null, "<html>", [{ token: "abc" }], 7]) {
      const transport: AuthTransport = {
        request: async () => ({ status: 200, body }) as unknown as AuthResponse,
      };
      await expect(new AuthClient(transport).loginWithCode(PHONE, "123456")).rejects.toMatchObject({
        error: { code: "invalid_response" },
      });
    }
  });

  it("binds an invite code as a form field", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200 }));
    await new AuthClient(transport).bindInviteCode("FIZZ7");
    expect(sent[0]).toEqual({
      method: "POST",
      path: "/user/recommendationcode/bind",
      form: { recommendationCode: "FIZZ7" },
    });
  });

  it("saves the nickname as JSON and never echoes the avatar back", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200 }));
    await new AuthClient(transport).saveProfile({ nickName: "Isaac" });
    expect(sent[0]).toEqual({
      method: "POST",
      path: "/user/update/user/info",
      json: { nickName: "Isaac" },
    });
  });

  it("sets a password with the optional old one", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200 }));
    const client = new AuthClient(transport);
    await client.setPassword("new");
    await client.setPassword("new", "old");
    expect(sent[0]?.form).toEqual({ password: "new" });
    expect(sent[1]?.form).toEqual({ password: "new", oldPassword: "old" });
  });

  it("uploads the avatar on the `file` field and returns the stored path", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200, data: "avatars/1.png" }));
    const file = new File(["x"], "a.png", { type: "image/png" });
    const path = await new AuthClient(transport).uploadAvatar(file);
    expect(sent[0]).toMatchObject({ path: "/user/uploadAratar", file: { field: "file" } });
    expect(path).toBe("avatars/1.png");
  });
});

/**
 * Password reset keeps the endpoints the deleted `/forgot-password` page
 * used — Java never folded them into `/user/new/*`, and they are keyed by
 * `phone` / `email` rather than `type` + `account`.
 */
describe("AuthClient — password reset", () => {
  it("asks for a phone reset code on the phone endpoint", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200 }));
    await new AuthClient(transport).sendResetCode(PHONE);
    expect(sent[0]).toEqual({
      method: "GET",
      path: "/user/getCode",
      query: { phone: "13800138000" },
    });
  });

  it("asks for an email reset code on the email endpoint", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200 }));
    await new AuthClient(transport).sendResetCode(EMAIL);
    expect(sent[0]).toEqual({
      method: "GET",
      path: "/user/email/getCode",
      query: { email: "isaac@fizzdragon.com" },
    });
  });

  it("sets the new password and signs the user in, by phone", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200, token: "tok" }));
    const session = await new AuthClient(transport).resetPassword(PHONE, "123456", "hunter2");
    expect(sent[0]).toEqual({
      method: "POST",
      path: "/user/reset/password",
      form: { phone: "13800138000", code: "123456", password: "hunter2" },
    });
    expect(session.token).toEqual({ name: "satoken", value: "tok" });
    // A reset is never a registration, whatever Java feels like sending.
    expect(session.isNewUser).toBe(false);
  });

  it("sets the new password and signs the user in, by email", async () => {
    const { transport, sent } = fakeTransport(() => ok({ code: 200, token: "tok" }));
    await new AuthClient(transport).resetPassword(EMAIL, "123456", "hunter2");
    expect(sent[0]).toEqual({
      method: "POST",
      path: "/user/email/reset/password",
      form: { email: "isaac@fizzdragon.com", code: "123456", password: "hunter2" },
    });
  });

  it("rejects a reset that stored the password but issued no session", async () => {
    const { transport } = fakeTransport(() => ok({ code: 200, msg: "ok" }));
    await expect(
      new AuthClient(transport).resetPassword(PHONE, "123456", "hunter2")
    ).rejects.toMatchObject({ error: { code: "token_missing" } });
  });

  it("maps a wrong code on the reset call, which is where it is checked", async () => {
    const { transport } = fakeTransport(() => ok({ code: 500, msg: "验证码错误" }));
    await expect(
      new AuthClient(transport).resetPassword(PHONE, "000000", "hunter2")
    ).rejects.toMatchObject({ error: { code: "code_incorrect", serverMessage: "验证码错误" } });
  });
});

describe("toAuthError", () => {
  it("unwraps our own error and wraps everything else", () => {
    const original = new AuthRequestError({ code: "rate_limited" });
    expect(toAuthError(original)).toEqual({ code: "rate_limited" });
    expect(toAuthError(new Error("boom"))).toEqual({
      code: "server_error",
      serverMessage: "boom",
    });
    expect(toAuthError("boom")).toEqual({ code: "server_error" });
  });
});
