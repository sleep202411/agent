import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "@/src/i18n/i18n";
import { TaskDeadline } from "./task-deadline";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.useRealTimers());
it.each(["en-US", "zh-CN", "zh-HK"])("renders real deadline translations in %s", async (locale) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
  await i18n.changeLanguage(locale);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    for (const [dueAt, hours] of [
      ["2026-09-30T10:00:00Z", "2"],
      ["2026-09-30T15:00:00Z", "3"],
      ["2026-10-03T12:00:00Z", "72"],
    ]) {
      act(() => root.render(<TaskDeadline dueAt={dueAt!} status="open" />));
      const label = host.textContent!.split(" · ").at(-1)!;
      expect(label).toContain(hours);
      expect(label).not.toMatch(/[{}]/);
    }
  } finally {
    act(() => root.unmount());
  }
});
