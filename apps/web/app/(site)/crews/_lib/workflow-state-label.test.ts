import { describe, expect, it } from "vitest";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";
import { workflowStateLabel } from "./workflow-state-label";

for (const [locale, messages] of Object.entries({ "en-US": en, "zh-CN": cn, "zh-HK": hk })) {
  const t = (key: string) =>
    key
      .split(".")
      .reduce<unknown>(
        (value, part) => (value as Record<string, unknown>)[part],
        messages.crewTaskProject
      ) as string;
  describe(locale, () => {
    it("localizes untouched defaults including Backlog", () => {
      expect(workflowStateLabel({ systemKey: "open", name: "To do" }, t)).toBe(
        messages.crewTaskProject.status.open
      );
      expect(workflowStateLabel({ systemKey: "backlog", name: "Backlog" }, t)).toBe(
        messages.crewTaskProject.backlog
      );
    });
    it("shows a saved rename without changing workflow behavior", () => {
      for (const name of ["剪辑初审", "Owner review", "待验收"]) {
        const state = { systemKey: "submitted", name };
        expect(workflowStateLabel(state, t)).toBe(name);
        expect(state.systemKey).toBe("submitted");
      }
    });
    it("keeps custom and unknown workflow names as user content", () => {
      expect(workflowStateLabel({ systemKey: null, name: "配音" }, t)).toBe("配音");
      expect(workflowStateLabel({ systemKey: "future", name: "Custom" }, t)).toBe("Custom");
    });
  });
}
