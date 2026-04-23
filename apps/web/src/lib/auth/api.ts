/**
 * Java Content auth endpoints — email + phone variants.
 *
 * All requests are x-www-form-urlencoded — that's what the Java backend
 * expects for the `/user/*` auth surface, and it matches what the old
 * fizzdragon-web `userService.js` ships in production. Spring's
 * `@RequestParam` also accepts these params on the URL query string,
 * but form body is the shape we know works.
 *
 * SaToken is returned via a Set-Cookie header on login / register /
 * reset, which the browser handles automatically. The response body
 * also carries the token so we can forward it across an iframe
 * postMessage to the embedding fizzdragon-web host.
 *
 * Endpoint map:
 *   Email login       POST /user/email/login           {email, pwd}
 *   Email register    POST /user/email/regist          {email, code, password, recommendationCode?}
 *   Email reset       POST /user/email/reset/password  {email, code, password}
 *   Email send code   GET  /user/email/getCode?email
 *   Phone login       POST /user/login                 {phone, pwd}
 *   Phone register    POST /user/regist                {phone, code, password, recommendationCode?}
 *   Phone reset       POST /user/reset/password        {phone, code, password}
 *   Phone send code   GET  /user/getCode?phone
 */

import { backendApi, type ApiResponse } from "@/src/lib/api";

export interface LoggedInUser {
  /**
   * Shape is whatever Java returns on `data` — we don't need a
   * tight schema here because the embed host parses it itself.
   * Still surface a couple of well-known fields for in-app use.
   */
  userId?: string | number;
  phone?: string;
  email?: string;
  nickname?: string;
  avatar?: string;
  [key: string]: unknown;
}

export interface AuthResult {
  /** SaToken value — used by the iframe bridge to postMessage to parent. */
  tokenValue?: string;
  /** Cookie/header name for SaToken (defaults to "satoken"). */
  tokenName?: string;
  user?: LoggedInUser;
  /** The raw `data` from Java, in case callers need extra fields. */
  raw: unknown;
}

function toAuthResult(data: unknown): AuthResult {
  const d = (data ?? {}) as Record<string, unknown>;
  const tokenInfo = (d.tokenInfo ?? {}) as { tokenName?: string; tokenValue?: string };
  const user = (d.user ?? d.userInfo ?? undefined) as LoggedInUser | undefined;
  return {
    tokenValue: tokenInfo.tokenValue,
    tokenName: tokenInfo.tokenName ?? "satoken",
    user,
    raw: d,
  };
}

export async function emailLogin(params: { email: string; pwd: string }): Promise<AuthResult> {
  const data = await backendApi.postForm<unknown>("/user/email/login", {
    email: params.email,
    pwd: params.pwd,
  });
  return toAuthResult(data);
}

export async function emailRegister(params: {
  email: string;
  code: string;
  password: string;
  recommendationCode?: string;
}): Promise<AuthResult> {
  const body: Record<string, string> = {
    email: params.email,
    code: params.code,
    password: params.password,
  };
  if (params.recommendationCode) body.recommendationCode = params.recommendationCode;
  const data = await backendApi.postForm<unknown>("/user/email/regist", body);
  return toAuthResult(data);
}

export async function emailResetPassword(params: {
  email: string;
  code: string;
  password: string;
}): Promise<AuthResult> {
  const data = await backendApi.postForm<unknown>("/user/email/reset/password", params);
  return toAuthResult(data);
}

export async function sendEmailCode(email: string): Promise<void> {
  await backendApi.get<ApiResponse<unknown>>("/user/email/getCode", {
    params: { email },
  });
}

export async function phoneLogin(params: { phone: string; pwd: string }): Promise<AuthResult> {
  const data = await backendApi.postForm<unknown>("/user/login", {
    phone: params.phone,
    pwd: params.pwd,
  });
  return toAuthResult(data);
}

export async function phoneRegister(params: {
  phone: string;
  code: string;
  password: string;
  recommendationCode?: string;
}): Promise<AuthResult> {
  const body: Record<string, string> = {
    phone: params.phone,
    code: params.code,
    password: params.password,
  };
  if (params.recommendationCode) body.recommendationCode = params.recommendationCode;
  const data = await backendApi.postForm<unknown>("/user/regist", body);
  return toAuthResult(data);
}

export async function phoneResetPassword(params: {
  phone: string;
  code: string;
  password: string;
}): Promise<AuthResult> {
  const data = await backendApi.postForm<unknown>("/user/reset/password", params);
  return toAuthResult(data);
}

export async function sendPhoneCode(phone: string): Promise<void> {
  await backendApi.get<ApiResponse<unknown>>("/user/getCode", {
    params: { phone },
  });
}

export async function logout(): Promise<void> {
  await backendApi.get<unknown>("/user/logout");
}
