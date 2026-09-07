import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationDTO } from "@repo/shared/notifications";
import { locales } from "@/src/i18n/config";
import { notificationHref } from "./deeplink";

/**
 * Every notification surface (bell dropdown, inbox page, live toast)
 * routes through this, because a raw `router.push(deeplink)` gets
 * caught by proxy.ts's no-prefix 307 and re-resolves the locale from
 * the NEXT_LOCALE cookie / Accept-Language — not from the locale the
 * reader is actually in.
 */
function notification(meta: Record<string, unknown> | undefined): NotificationDTO {
  return {
    id: "n_1",
    type: "crew.task.assigned",
    title: "New assignment",
    body: "EP01 storyboard",
    meta,
    readAt: null,
    createdAt: new Date().toISOString(),
  } as NotificationDTO;
}

const CREW_DEEPLINK = "/crews/c_1/workspace?tab=episodes&episode=ep_1&assignment=as_1";

describe("notificationHref", () => {
  it.each(locales)("prefixes the crew deeplink with %s", (locale) => {
    const href = notificationHref(notification({ deeplink: CREW_DEEPLINK }), locale);

    expect(href).toBe(`/${locale}${CREW_DEEPLINK}`);
    expect(href?.split("/")[1]).toBe(locale);
  });

  it("keeps the workspace query string intact", () => {
    const href = notificationHref(notification({ deeplink: CREW_DEEPLINK }), "zh-HK");

    const url = new URL(href!, "https://fizzdragon.com");
    expect(url.pathname).toBe("/zh-HK/crews/c_1/workspace");
    expect(url.searchParams.get("tab")).toBe("episodes");
    expect(url.searchParams.get("episode")).toBe("ep_1");
    expect(url.searchParams.get("assignment")).toBe("as_1");
  });

  it.each([undefined, {}, { deeplink: "" }, { deeplink: 42 }, { deeplink: { to: "/x" } }])(
    "yields no navigation for meta %o",
    (meta) => {
      expect(notificationHref(notification(meta), "en-US")).toBeNull();
    }
  );
});

describe("notification destination ownership", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["studio.fizzdragon.com", "studio.fizzspace.cn", "localhost:9540"])(
    "routes Studio links through %s",
    (host) => {
      vi.stubEnv("NEXT_PUBLIC_STUDIO_HOST", host);
      for (const locale of locales) {
        for (const path of [
          "/story-studio/projects/story-1/canvas?chapter=ch-1#node-2",
          "/project/p-1",
          "/canvas?ws=team-1",
          "/invite/token-1",
        ]) {
          const origin = host.startsWith("localhost") ? `http://${host}` : `https://${host}`;
          expect(notificationHref(notification({ deeplink: path }), locale)).toBe(
            `${origin}/${locale}${path}`
          );
        }
      }
    }
  );
  it("does not silently route to another site without a Studio host", () => {
    vi.stubEnv("NEXT_PUBLIC_STUDIO_HOST", "");
    expect(() => notificationHref(notification({ deeplink: "/project/p-1" }), "en-US")).toThrow(
      "NEXT_PUBLIC_STUDIO_HOST"
    );
  });
  it("keeps web projects and conversations on the web app", () => {
    for (const path of [
      "/projects/legacy-1",
      "/messages/chat-1",
      "/crew-invitations/invite-1",
      "/invite?code=legacy-code",
    ]) {
      expect(notificationHref(notification({ deeplink: path }), "zh-CN")).toBe(`/zh-CN${path}`);
    }
  });
  it("uses the current language for stored locale-prefixed links", () => {
    expect(
      notificationHref(notification({ deeplink: "/en-US/crews/c-1?tab=tasks" }), "zh-HK")
    ).toBe("/zh-HK/crews/c-1?tab=tasks");
  });
  it.each([
    "javascript:alert(1)",
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/a\nb",
  ])("ignores non-product link %s", (deeplink) => {
    expect(notificationHref(notification({ deeplink }), "en-US")).toBeNull();
  });
});
