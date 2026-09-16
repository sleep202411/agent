import { afterEach, describe, expect, it, vi } from "vitest";
import { relayAdminResponse } from "./admin-route";

describe("admin response relay", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([204, 205, 304])("preserves bodyless HTTP %s responses", async (status) => {
    const result = await relayAdminResponse(new Response(null, { status }));
    expect(result.status).toBe(status);
    expect(result.body).toBeNull();
  });
  it("keeps multiple cookies separate and scopes each path without splitting expiry dates", async () => {
    vi.stubEnv("NEXT_PUBLIC_ADMIN_UI_BASE_PATH", "/console");
    const headers = new Headers();
    headers.append("set-cookie", "session=abc; Path=/; HttpOnly; Secure; SameSite=Lax");
    headers.append("set-cookie", "old=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly");
    headers.set("location", "/console");
    headers.set("cache-control", "no-store");
    const result = await relayAdminResponse(new Response("redirect", { status: 302, headers }));
    expect(result.headers.getSetCookie()).toEqual([
      "session=abc; Path=/console; HttpOnly; Secure; SameSite=Lax",
      "old=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Path=/console",
    ]);
    expect(result.headers.get("location")).toBe("/console");
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.text()).toBe("redirect");
  });
});
