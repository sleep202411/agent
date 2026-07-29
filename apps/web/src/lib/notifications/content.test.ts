import { describe, expect, it } from "vitest";
import type { NotificationDTO } from "@repo/shared/notifications";
import { notificationContent } from "./content";

const translate = (key: string, values?: Record<string, string | number | Date>) =>
  Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    {
      "events.taskSubmitted.title": "任务已提交：{task}",
      "events.taskSubmitted.body": "提交版本 v{version} 正在等待审核。",
      "events.taskRevisionRequested.title": "任务需要修改：{task}",
      "events.settlementSettled.title": "结算已记录：{task}",
      "events.settlementSettled.body": "{points} 积分已换算为 {payout}。",
      "events.settlementSettled.fallbackBody": "剧组已记录该任务结算。",
    }[key] ?? key
  );

function row(
  type: string,
  meta: NotificationDTO["meta"],
  overrides: Partial<NotificationDTO> = {}
): NotificationDTO {
  return {
    id: "notification-1",
    type,
    title: "English fallback title",
    body: "English fallback body",
    meta,
    readAt: null,
    createdAt: "2026-07-29T12:00:00.000Z",
    ...overrides,
  };
}

describe("notificationContent", () => {
  it("renders a task submission from semantic metadata in the active locale", () => {
    expect(
      notificationContent(
        row("crew.task.submitted", {
          taskTitle: "SC.010 场景图确认",
          submissionVersion: 3,
        }),
        "zh-CN",
        translate
      )
    ).toEqual({
      title: "任务已提交：SC.010 场景图确认",
      body: "提交版本 v3 正在等待审核。",
    });
  });

  it("preserves a human review note instead of translating user-authored content", () => {
    expect(
      notificationContent(
        row("crew.task.revision_requested", {
          taskTitle: "SC.010 场景图确认",
          reviewNote: "角色比例还需要调整",
        }),
        "zh-CN",
        translate
      )
    ).toEqual({
      title: "任务需要修改：SC.010 场景图确认",
      body: "角色比例还需要调整",
    });
  });

  it("formats settlement currency using the reader locale", () => {
    expect(
      notificationContent(
        row("crew.settlement.settled", {
          taskTitle: "SC.010 场景图确认",
          pointsAmount: "1250",
          payoutAmountMinor: "1250",
          payoutCurrency: "USD",
        }),
        "zh-CN",
        translate
      )
    ).toEqual({
      title: "结算已记录：SC.010 场景图确认",
      body: "1250 积分已换算为 US$12.50。",
    });
  });

  it("localizes a historical settlement even when its deleted ledger row cannot be enriched", () => {
    expect(
      notificationContent(
        row("crew.settlement.settled", {
          taskTitle: "SC.010 场景图确认",
        }),
        "zh-CN",
        translate
      )
    ).toEqual({
      title: "结算已记录：SC.010 场景图确认",
      body: "剧组已记录该任务结算。",
    });
  });

  it("keeps persisted copy for unknown and historical events without semantic metadata", () => {
    const item = row("crew.task.submitted", {});
    expect(notificationContent(item, "zh-CN", translate)).toEqual({
      title: item.title,
      body: item.body,
    });
  });
});
