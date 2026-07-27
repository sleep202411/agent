/**
 * The Java auth contract, in one place.
 *
 *   GET  /user/new/getCode        ?type=phone|email&account=…
 *   POST /user/new/login          type=phone|email|pwd, account, code|pwd
 *                                 → { code, msg, token, isNewUser, userId }
 *   POST /user/recommendationcode/bind   recommendationCode   (authed)
 *   POST /user/set/password              password, oldPassword?   (authed)
 *   POST /user/uploadAratar              multipart `file` → avatar path
 *   POST /user/update/user/info          JSON { nickName }        (authed)
 *
 * Password reset keeps its OWN, older pair of endpoints — Java never
 * folded them into the `/user/new/*` surface, so the reset flow speaks
 * exactly what the deleted `/forgot-password` page spoke:
 *
 *   GET  /user/getCode            ?phone=…
 *   GET  /user/email/getCode      ?email=…
 *   POST /user/reset/password            phone, code, password
 *   POST /user/email/reset/password      email, code, password
 *                                 → the same session envelope as a login
 *
 * `type=pwd` is the legacy password path and never auto-registers, which
 * is exactly why the one-button code flow is the primary entry.
 */

import { authError, mapServerMessage, type AuthError, type AuthOperation } from "./errors";
import {
  persistSessionCookie,
  readEnvelope,
  readIsNewUser,
  readSessionToken,
  readUserId,
} from "./session";
import { AuthTransportError, isJsonObject, type AuthTransport } from "./transport";
import type { AuthSession, NormalizedIdentifier } from "./types";

/** Thrown by every client method; always carries a typed `AuthError`. */
export class AuthRequestError extends Error {
  readonly error: AuthError;

  constructor(error: AuthError) {
    super(error.serverMessage ?? error.code);
    this.name = "AuthRequestError";
    this.error = error;
  }
}

export class AuthClient {
  constructor(private readonly transport: AuthTransport) {}

  async sendCode(identifier: NormalizedIdentifier): Promise<void> {
    await this.call(
      {
        method: "GET",
        path: "/user/new/getCode",
        query: { type: identifier.kind, account: identifier.account },
      },
      "send_code"
    );
  }

  /**
   * The reset flow's code. A DIFFERENT endpoint from `sendCode` — Java
   * scopes reset codes to the reset call — but the same SMS bill, which
   * is why both go through the one cooldown in `resend-clock`.
   */
  async sendResetCode(identifier: NormalizedIdentifier): Promise<void> {
    await this.call(
      identifier.kind === "email"
        ? { method: "GET", path: "/user/email/getCode", query: { email: identifier.account } }
        : { method: "GET", path: "/user/getCode", query: { phone: identifier.account } },
      "send_code"
    );
  }

  async loginWithCode(identifier: NormalizedIdentifier, code: string): Promise<AuthSession> {
    return this.login(
      identifier,
      { type: identifier.kind, account: identifier.account, code },
      "verify_code"
    );
  }

  async loginWithPassword(
    identifier: NormalizedIdentifier,
    password: string
  ): Promise<AuthSession> {
    // `type=pwd` regardless of whether `account` is a phone or an email —
    // Java switches on the credential kind here, not the account kind.
    return this.login(
      identifier,
      { type: "pwd", account: identifier.account, pwd: password },
      "password_login"
    );
  }

  /**
   * Set a new password with a code, for someone who cannot sign in.
   *
   * One request: Java checks the code AND stores the password, then
   * answers with a session envelope — so the user ends up signed in
   * holding a password they know, which is what "forgot password" is
   * for. There is no separate "verify the code" round trip to hang a
   * screen on, and inventing one would lie about what has been checked.
   */
  async resetPassword(
    identifier: NormalizedIdentifier,
    code: string,
    password: string
  ): Promise<AuthSession> {
    const isEmail = identifier.kind === "email";
    return this.login(
      identifier,
      isEmail
        ? { email: identifier.account, code, password }
        : { phone: identifier.account, code, password },
      "reset_password",
      isEmail ? "/user/email/reset/password" : "/user/reset/password"
    );
  }

  async bindInviteCode(recommendationCode: string): Promise<void> {
    await this.call(
      {
        method: "POST",
        path: "/user/recommendationcode/bind",
        form: { recommendationCode },
      },
      "bind_invite"
    );
  }

  /**
   * Commits immediately server-side and returns the stored path — there is
   * no separate "save avatar" step, which is why the profile step can show
   * the uploaded image before the user presses continue.
   */
  async uploadAvatar(file: File): Promise<string> {
    const envelope = await this.call(
      {
        method: "POST",
        path: "/user/uploadAratar",
        file: { field: "file", value: file },
      },
      "upload_avatar"
    );
    const data = envelope.body.data;
    return typeof data === "string" ? data : "";
  }

  async saveProfile(input: { nickName: string }): Promise<void> {
    // Avatar is intentionally absent: `uploadAvatar` already persisted it,
    // and echoing it back has overwritten a freshly-uploaded path with a
    // stale one before.
    await this.call(
      {
        method: "POST",
        path: "/user/update/user/info",
        json: { nickName: input.nickName },
      },
      "save_profile"
    );
  }

  async setPassword(password: string, oldPassword?: string): Promise<void> {
    await this.call(
      {
        method: "POST",
        path: "/user/set/password",
        form: oldPassword ? { password, oldPassword } : { password },
      },
      "set_password"
    );
  }

  private async login(
    identifier: NormalizedIdentifier,
    form: Record<string, string>,
    operation: AuthOperation,
    path = "/user/new/login"
  ): Promise<AuthSession> {
    const envelope = await this.call({ method: "POST", path, form }, operation);
    const token = readSessionToken(envelope.body);
    if (!token) {
      // A 200 without a token is not a login. Failing here keeps the old
      // "dialog closed, still signed out" bug impossible.
      throw new AuthRequestError(authError("token_missing", envelope.msg));
    }
    // Write the cookie ourselves — Java's Domain is wrong off .com and
    // Safari commits Set-Cookie asynchronously. See session.ts.
    persistSessionCookie(token);
    return {
      token,
      isNewUser: readIsNewUser(envelope.body),
      userId: readUserId(envelope.body),
      identifier,
    };
  }

  private async call(request: Parameters<AuthTransport["request"]>[0], operation: AuthOperation) {
    let response;
    try {
      response = await this.transport.request(request);
    } catch (thrown) {
      // `invalid_response` is NOT a network error: something answered,
      // with bytes that are not this contract. Telling the user to check
      // their connection would send them chasing the wrong problem.
      const reason =
        thrown instanceof AuthTransportError && thrown.reason === "invalid_response"
          ? "invalid_response"
          : "network";
      throw new AuthRequestError(authError(reason));
    }
    // A hand-written transport can still hand back anything; the envelope
    // contract is enforced here rather than trusted.
    if (!isJsonObject(response.body)) {
      throw new AuthRequestError(authError("invalid_response"));
    }
    const envelope = readEnvelope(response.body, response.status);
    if (!envelope.ok) {
      throw new AuthRequestError(
        authError(mapServerMessage(envelope.msg, operation), envelope.msg)
      );
    }
    return { ...envelope, body: response.body };
  }
}

/** Normalize anything thrown inside the flow into a typed `AuthError`. */
export function toAuthError(thrown: unknown): AuthError {
  if (thrown instanceof AuthRequestError) return thrown.error;
  if (thrown instanceof Error) return authError("server_error", thrown.message);
  return authError("server_error");
}
