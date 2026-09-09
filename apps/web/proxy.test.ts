import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

// STUDIO_ORIGIN is a module-load constant derived from NEXT_PUBLIC_STUDIO_HOST,
// so the prod value must be set before proxy.ts is imported.
process.env.NEXT_PUBLIC_STUDIO_HOST = "studio.fizzdragon.com";

let proxy: (typeof import("./proxy"))["proxy"];

beforeAll(async () => {
  ({ proxy } = await import("./proxy"));
});

function request(path: string): NextRequest {
  return new NextRequest(`https://fizzdragon.com${path}`, {
    headers: {
      host: "fizzdragon.com",
      // /projects and /art-studio are protected; a session cookie lets the
      // request reach the studio-routing logic instead of the login gate.
      cookie: "satoken=test-session",
    },
  });
}

describe("web proxy — studio routing (STUDIO_ORIGIN set, apex host)", () => {
  it("resolves a legacy /projects/<id> deep link IN PLACE — rewrite, never a redirect", () => {
    const res = proxy(request("/zh-HK/projects/533341398968313980"));

    // A rewrite keeps the URL and routes internally into the /art-studio tree.
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      "/art-studio/projects/533341398968313980"
    );
    // It must NOT be a redirect to the studio subdomain (the reported bug).
    expect(res.headers.get("location")).toBeNull();
  });

  it("resolves the /projects listing in place too", () => {
    const res = proxy(request("/zh-HK/projects"));
    expect(res.headers.get("x-middleware-rewrite")).toContain("/art-studio/projects");
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects /art-studio/* to the standalone studio subdomain", () => {
    const res = proxy(request("/zh-HK/art-studio/settings"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://studio.fizzdragon.com/zh-HK");
  });
});

describe("copied notification links", () => {
  it("keeps the legacy code-based invitation on the web app", () => {
    const res = proxy(request("/zh-CN/invite?code=legacy-code&projectId=legacy-1"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toContain(
      "/invite?code=legacy-code&projectId=legacy-1"
    );
  });
  it.each([
    "/story-studio/projects/story-1/canvas?chapter=ch-1",
    "/project/p-1",
    "/canvas?ws=team-1",
    "/invite/token-1",
  ])("preserves %s on the Studio host", (path) => {
    const res = proxy(request(`/zh-CN${path}`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`https://studio.fizzdragon.com/zh-CN${path}`);
  });
});

describe("anonymous room-number links", () => {
  it.each(["en-US", "zh-CN", "zh-HK"])("opens a room without login in %s", (locale) => {
    const res = proxy(new NextRequest(`https://fizzdragon.com/${locale}/ip/100001`));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBe("https://fizzdragon.com/ip/100001");
    expect(res.headers.get("x-middleware-request-x-locale")).toBe(locale);
  });

  it("lets the detail route reject malformed numbers without opening nested routes", () => {
    const invalid = proxy(new NextRequest("https://fizzdragon.com/zh-CN/ip/0100001"));
    expect(invalid.headers.get("location")).toBeNull();
    expect(invalid.headers.get("x-middleware-rewrite")).toBe("https://fizzdragon.com/ip/0100001");

    const nested = proxy(new NextRequest("https://fizzdragon.com/zh-CN/ip/100001/edit"));
    expect(nested.status).toBe(307);
    expect(new URL(nested.headers.get("location")!).pathname).toBe("/zh-CN/login");
  });
});
