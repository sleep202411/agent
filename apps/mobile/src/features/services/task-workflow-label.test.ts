import { expect, it } from "vitest";
import enUS from "@/i18n/messages/en-US.json";
import zhCN from "@/i18n/messages/zh-CN.json";
import zhHK from "@/i18n/messages/zh-HK.json";
import { taskWorkflowLabel } from "./task-workflow-label";

const seeds = [
  ["backlog", "Backlog"],
  ["open", "To do"],
  ["in_progress", "In progress"],
  ["submitted", "In review"],
  ["revision_requested", "Changes requested"],
  ["approved", "Completed"],
  ["cancelled", "Cancelled"],
] as const;
for (const [locale, messages, expected] of [
  [
    "en-US",
    enUS,
    ["Backlog", "Pending delivery", "In progress", "In review", "Revision", "Done", "Cancelled"],
  ],
  ["zh-CN", zhCN, ["Backlog", "待交付", "进行中", "待审核", "待修改", "已完成", "已取消"]],
  ["zh-HK", zhHK, ["Backlog", "待交付", "進行中", "待審核", "待修改", "已完成", "已取消"]],
] as const) {
  const t = (key: keyof typeof enUS) => messages[key];
  seeds.forEach(([systemKey, name], index) => {
    it(`${locale}: localizes the untouched ${systemKey} seed`, () => {
      expect(taskWorkflowLabel({ systemKey, name }, t)).toBe(expected[index]);
    });
  });
  it(`${locale}: preserves owner renames regardless of system behavior`, () => {
    for (const [systemKey] of seeds) {
      expect(taskWorkflowLabel({ systemKey, name: "导演复核 / Final review" }, t)).toBe(
        "导演复核 / Final review"
      );
    }
  });
  it(`${locale}: never infers a default from the name alone`, () => {
    for (const systemKey of [null, undefined, "custom", "toString"]) {
      expect(taskWorkflowLabel({ systemKey, name: "To do" }, t)).toBe("To do");
    }
    expect(taskWorkflowLabel({ systemKey: "open", name: "To do " }, t)).toBe("To do ");
  });
}
