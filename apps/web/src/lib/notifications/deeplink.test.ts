import { describe, expect, it } from "vitest";
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
    type: "crew.episode.assigned",
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
