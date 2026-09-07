import { describe, expect, it } from "vitest";
import type { NotificationDTO } from "@repo/shared/notifications";
import { notificationHref } from "./deeplink";

const item = (deeplink: string): NotificationDTO => ({
  id: "n1",
  type: "story-project.member.added",
  title: "Added",
  body: "A story",
  meta: { deeplink },
  readAt: null,
  createdAt: "2026-09-01T00:00:00Z",
});

describe("Studio notification links", () => {
  it.each(["cn", "global"] as const)(
    "keeps story and canvas links in the current %s Studio",
    (region) => {
      for (const path of [
        "/story-studio/projects/s1/canvas?chapter=c1",
        "/project/p1",
        "/canvas?ws=w1",
      ]) {
        expect(notificationHref(item(path), "zh-CN", region)).toBe(`/zh-CN${path}`);
      }
    }
  );
  it.each([
    ["cn", "https://fizzdragon.fizzspace.cn"],
    ["global", "https://fizzdragon.com"],
  ] as const)("takes crew notifications to the %s main site", (region, origin) => {
    expect(notificationHref(item("/crews/c1/workspace?tab=tasks&task=t1"), "zh-HK", region)).toBe(
      `${origin}/zh-HK/crews/c1/workspace?tab=tasks&task=t1`
    );
  });
});
