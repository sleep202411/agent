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
      "events.earning.posted.title": "积分已确认：{title}",
      "events.earning.posted.body": "{points} 已计入你的剧组积分账本。",
      "events.earning.rejected.title": "积分记录已驳回：{title}",
      "events.earning.rejected.body": "{points} 未计入你的剧组积分账本。",
      "events.earning.reversed.title": "积分已冲回：{title}",
      "events.earning.reversed.body": "{points} 已从你的剧组积分账本扣回。",
      "events.payout.paid.title": "资金已发放",
      "events.payout.paid.body": "{points} 对应的 {amount} 已完成发放。",
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

  it("localizes confirmed crew points without inventing a cash value", () => {
    expect(
      notificationContent(
        row("crew.earning.posted", {
          earningTitle: "第一幕分镜奖金",
          pointsAmount: "1250",
        }),
        "zh-CN",
        translate
      )
    ).toEqual({
      title: "积分已确认：第一幕分镜奖金",
      body: "1,250 pts 已计入你的剧组积分账本。",
    });
  });

  it("keeps bigint point amounts precise in localized notifications", () => {
    expect(
      notificationContent(
        row("crew.earning.posted", {
          earningTitle: "长期收益分成",
          pointsAmount: "9223372036854775807",
        }),
        "en-US",
        translate
      ).body
    ).toBe("9,223,372,036,854,775,807 pts 已计入你的剧组积分账本。");
  });

  it.each([
    ["crew.earning.rejected", "积分记录已驳回：合同尾款", "800 pts 未计入你的剧组积分账本。"],
    ["crew.earning.reversed", "积分已冲回：合同尾款", "800 pts 已从你的剧组积分账本扣回。"],
  ])("localizes %s from semantic metadata", (type, title, body) => {
    expect(
      notificationContent(
        row(type, { earningTitle: "合同尾款", pointsAmount: "800" }),
        "zh-CN",
        translate
      )
    ).toEqual({ title, body });
  });

  it("renders cash only for a concrete payout event", () => {
    expect(
      notificationContent(
        row("crew.payout.paid", {
          pointsAmount: "2500",
          netAmountMinor: "88000",
          currency: "CNY",
        }),
        "zh-CN",
        translate
      )
    ).toEqual({
      title: "资金已发放",
      body: "2,500 pts 对应的 ¥880.00 已完成发放。",
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
