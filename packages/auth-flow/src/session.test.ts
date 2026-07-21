import { describe, expect, it } from "vitest";

import { readEnvelope, readIsNewUser, readSessionToken, readUserId } from "./session";

describe("readSessionToken — the four observed Java shapes", () => {
  it("1. top-level `token` (what /user/new/login returns today)", () => {
    expect(readSessionToken({ code: 200, msg: "ok", token: "abc123" })).toEqual({
      name: "satoken",
      value: "abc123",
    });
  });

  it("2. inside `data`", () => {
    expect(readSessionToken({ code: 200, data: { token: "abc123" } })).toEqual({
      name: "satoken",
      value: "abc123",
    });
  });

  it("3. `tokenValue` directly, at either level", () => {
    expect(readSessionToken({ code: 200, tokenValue: "abc123" })).toEqual({
      name: "satoken",
      value: "abc123",
    });
    expect(readSessionToken({ code: 200, data: { tokenValue: "abc123" } })).toEqual({
      name: "satoken",
      value: "abc123",
    });
  });

  it("4. nested under `tokenInfo`, at either level", () => {
    expect(
      readSessionToken({ code: 200, tokenInfo: { tokenName: "satoken", tokenValue: "abc123" } })
    ).toEqual({ name: "satoken", value: "abc123" });
    expect(
      readSessionToken({ code: 200, data: { tokenInfo: { tokenName: "fizz", tokenValue: "xyz" } } })
    ).toEqual({ name: "fizz", value: "xyz" });
  });

  it("resolves a value keyed by the reported token name", () => {
    expect(
      readSessionToken({ code: 200, data: { tokenName: "fizztoken", fizztoken: "xyz" } })
    ).toEqual({ name: "fizztoken", value: "xyz" });
  });

  it("returns null when there is no usable token — a 200 alone is not a login", () => {
    expect(readSessionToken({ code: 200, msg: "ok" })).toBeNull();
    expect(readSessionToken({ code: 200, token: "" })).toBeNull();
    expect(readSessionToken(null)).toBeNull();
    expect(readSessionToken("nonsense")).toBeNull();
    expect(readSessionToken([{ token: "abc" }])).toBeNull();
  });
});

describe("readEnvelope", () => {
  it("treats code !== 200 as failure even on HTTP 200", () => {
    const envelope = readEnvelope({ code: 500, msg: "验证码错误" }, 200);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(500);
    expect(envelope.msg).toBe("验证码错误");
  });

  it("accepts a string code of 200 (Java is inconsistent about the type)", () => {
    expect(readEnvelope({ code: "200" }, 200).ok).toBe(true);
  });

  it("falls back to the HTTP status when the body carries no code", () => {
    expect(readEnvelope({}, 200).ok).toBe(true);
    expect(readEnvelope(null, 502)).toMatchObject({ ok: false, code: 502 });
  });

  it("reads `message` when Java sends that instead of `msg`", () => {
    expect(readEnvelope({ code: 400, message: "bad" }, 200).msg).toBe("bad");
  });
});

describe("readIsNewUser / readUserId", () => {
  it("accepts the loose types Java sends", () => {
    expect(readIsNewUser({ isNewUser: true })).toBe(true);
    expect(readIsNewUser({ isNewUser: 1 })).toBe(true);
    expect(readIsNewUser({ isNewUser: "true" })).toBe(true);
    expect(readIsNewUser({ data: { isNewUser: true } })).toBe(true);
    expect(readIsNewUser({ isNewUser: 0 })).toBe(false);
    expect(readIsNewUser({})).toBe(false);
  });

  it("stringifies numeric user ids", () => {
    expect(readUserId({ userId: 42 })).toBe("42");
    expect(readUserId({ data: { id: "u_1" } })).toBe("u_1");
    expect(readUserId({})).toBeUndefined();
  });
});
