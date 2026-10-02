import { describe, expect, it } from "vitest";
import type { NotificationDTO } from "@repo/shared/notifications";
import enUS from "@/i18n/messages/en-US.json";
import zhCN from "@/i18n/messages/zh-CN.json";
import zhHK from "@/i18n/messages/zh-HK.json";
import { notificationContent } from "./notification-content";

const translate = (key: string, values?: Record<string, string | number | Date>) =>
  Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    {
      "events.taskSubmitted.title": "任务已提交：{task}",
      "events.taskSubmitted.body": "提交版本 v{version} 正在等待审核。",
      "events.taskRevisionRequested.title": "任务需要修改：{task}",
      "events.earning.posted.title": "收益已确认：{title}",
      "events.earning.posted.body": "{amount} 已计入你的剧组收益账本。",
      "events.earning.rejected.title": "收益记录已驳回：{title}",
      "events.earning.rejected.body": "{amount} 未计入你的剧组收益账本。",
      "events.earning.reversed.title": "收益已冲回：{title}",
      "events.earning.reversed.body": "{amount} 已从你的剧组收益账本扣回。",
      "events.payout.paid.title": "资金已发放",
      "events.payout.paid.body": "总额 {grossAmount}，实付 {amount}。",
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

  it("localizes an earning in its recorded currency", () => {
    expect(
      notificationContent(
        row("crew.earning.posted", {
          currency: "USD",
          earningTitle: "第一幕分镜奖金",
          amountMinor: "1250",
        }),
        "zh-CN",
        translate
      )
    ).toEqual({
      title: "收益已确认：第一幕分镜奖金",
      body: "US$12.50 已计入你的剧组收益账本。",
    });
  });

  it("keeps bigint minor-unit amounts precise in localized notifications", () => {
    expect(
      notificationContent(
        row("crew.earning.posted", {
          currency: "USD",
          earningTitle: "长期收益分成",
          amountMinor: "9223372036854775807",
        }),
        "en-US",
        translate
      ).body
    ).toBe("USD 92,233,720,368,547,758.07 已计入你的剧组收益账本。");
  });

  it.each([
    ["crew.earning.rejected", "收益记录已驳回：合同尾款", "US$8.00 未计入你的剧组收益账本。"],
    ["crew.earning.reversed", "收益已冲回：合同尾款", "US$8.00 已从你的剧组收益账本扣回。"],
  ])("localizes %s from semantic metadata", (type, title, body) => {
    expect(
      notificationContent(
        row(type, { currency: "USD", earningTitle: "合同尾款", amountMinor: "800" }),
        "zh-CN",
        translate
      )
    ).toEqual({ title, body });
  });

  it("renders gross and net payout amounts", () => {
    expect(
      notificationContent(
        row("crew.payout.paid", {
          amountMinor: "2500",
          netAmountMinor: "2000",
          currency: "CNY",
        }),
        "zh-CN",
        translate
      )
    ).toEqual({
      title: "资金已发放",
      body: "总额 ¥25.00，实付 ¥20.00。",
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

it.each([
  ["en-US", enUS],
  ["zh-CN", zhCN],
  ["zh-HK", zhHK],
] as const)(
  "renders actual monetary translations without old point placeholders in %s",
  (locale, catalog) => {
    const t = (key: string, values?: Record<string, string | number | Date>) => {
      const template = catalog[`notifications.${key}` as keyof typeof catalog];
      return Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        template
      );
    };
    for (const type of [
      "crew.earning.posted",
      "crew.earning.rejected",
      "crew.earning.reversed",
      "crew.payout.scheduled",
      "crew.payout.paid",
      "crew.payout.voided",
    ]) {
      const result = notificationContent(
        row(type, {
          earningTitle: "Test",
          currency: "USD",
          amountMinor: "1029",
          netAmountMinor: "900",
        }),
        locale,
        t
      );
      expect(result.title + result.body).not.toMatch(/points|pts|积分|積分|\{\w+\}/i);
      expect(result.body).toContain("10.29");
    }
  }
);

it.each([
  ["en-US", enUS],
  ["zh-CN", zhCN],
  ["zh-HK", zhHK],
] as const)(
  "includes the actor name in assignment and update messages in %s",
  (locale, catalog) => {
    for (const [type, key] of [
      ["crew.task.assigned", "taskAssigned"],
      ["crew.task.updated", "taskUpdated"],
    ] as const) {
      const t = (path: string, values?: Record<string, string | number | Date>) => {
        const text = path.endsWith("bodyWithActor")
          ? catalog[`notifications.events.${key}.bodyWithActor`]
          : path;
        return text.replace("{actor}", String(values?.actor ?? ""));
      };
      const result = notificationContent(
        row(type, { taskTitle: "Storyboard" }),
        locale,
        t,
        "Isaac"
      );
      expect(result.body).toBe(
        catalog[`notifications.events.${key}.bodyWithActor`].replace("{actor}", "Isaac")
      );
      expect(notificationContent(row(type, { taskTitle: "Storyboard" }), locale, t, " ").body).toBe(
        `events.${key}.body`
      );
    }
  }
);
