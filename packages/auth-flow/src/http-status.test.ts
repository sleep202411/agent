import { describe, expect, it } from "vitest";
import { AuthClient, AuthRequestError } from "./client";
import { createFetchTransport } from "./transport";
import { readEnvelope } from "./session";

const identifier = { kind: "email" as const, account: "test@example.invalid" };
function client(status: number, body: Record<string, unknown>) {
  return new AuthClient(
    createFetchTransport({
      fetchImpl: async () => new Response(JSON.stringify(body), { status }),
    })
  );
}

describe("auth HTTP failure cannot be overridden by JSON success", () => {
  it.each([400, 401, 403, 429, 500, 503])(
    "rejects HTTP %i even with a code-200 token",
    async (status) => {
      await expect(
        client(status, { code: 200, token: "must-not-use", msg: "Rejected" }).loginWithCode(
          identifier,
          "123456"
        )
      ).rejects.toBeInstanceOf(AuthRequestError);
    }
  );
  it("does not report a verification code as sent after an HTTP failure", async () => {
    await expect(
      client(503, { code: "200", msg: "Unavailable" }).sendCode(identifier)
    ).rejects.toBeInstanceOf(AuthRequestError);
  });
  it("preserves the actual HTTP failure code for diagnostics", () => {
    expect(readEnvelope({ code: 200, msg: "Denied" }, 403)).toMatchObject({
      ok: false,
      code: 403,
      msg: "Denied",
    });
  });
  it("still accepts valid numeric/string Java success codes over HTTP 200", async () => {
    for (const code of [200, "200"]) {
      await expect(
        client(200, { code, token: "valid" }).loginWithCode(identifier, "123456")
      ).resolves.toMatchObject({ token: { value: "valid" } });
    }
  });
});
