import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TaskDeadline, taskDeadlineState } from "./task-deadline";
import en from "@/i18n/messages/en-US.json";
import cn from "@/i18n/messages/zh-CN.json";
import hk from "@/i18n/messages/zh-HK.json";
const h = vi.hoisted(() => ({ active: true, locale: "en-US" }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: keyof typeof en) =>
    ({ "en-US": en, "zh-CN": cn, "zh-HK": hk })[h.locale as "en-US"][key],
}));
const now = Date.parse("2026-09-30T12:00:00Z");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  h.active = true;
  h.locale = "en-US";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});
it.each(["en-US", "zh-CN", "zh-HK"])("interpolates deadline hours in %s", (locale) => {
  h.locale = locale;
  for (const [due, hours] of [
    ["2026-09-30T10:00:00Z", "2"],
    ["2026-09-30T15:00:00Z", "3"],
    ["2026-10-03T12:00:00Z", "72"],
  ]) {
    act(() => root.render(<TaskDeadline dueAt={due!} status="open" />));
    expect(host.textContent).toContain(hours);
    expect(host.textContent).not.toMatch(/[{}]/);
  }
});
it("advances due-soon to overdue without a network request", () => {
  act(() => root.render(<TaskDeadline dueAt="2026-09-30T12:00:30Z" status="open" />));
  expect(host.textContent).toContain("Due soon · 1 h left");
  act(() => vi.advanceTimersByTime(60_000));
  expect(host.textContent).toContain("Overdue · 1 h");
});
it.each(["approved", "cancelled"])("does not count down closed %s tasks", (status) => {
  act(() => root.render(<TaskDeadline dueAt="2026-09-29T12:00:00Z" status={status} />));
  expect(host.textContent).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});
it.each([null, "invalid"])("does not display missing/invalid deadline %s", (dueAt) => {
  act(() => root.render(<TaskDeadline dueAt={dueAt} status="open" />));
  expect(host.textContent).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});
it("releases the timer while backgrounded and uses current time on return", () => {
  const render = () => root.render(<TaskDeadline dueAt="2026-09-30T13:00:00Z" status="open" />);
  act(render);
  expect(vi.getTimerCount()).toBe(1);
  h.active = false;
  act(render);
  expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(now + 3 * 3_600_000);
  h.active = true;
  act(render);
  expect(host.textContent).toContain("Overdue · 2 h");
});
it("honors warning windows and timezone offsets", () => {
  expect(taskDeadlineState("2026-10-01T12:00:00Z", "open", now, 24)?.state).toBe("soon");
  expect(taskDeadlineState("2026-10-01T12:00:00Z", "open", now, 12)?.state).toBe("upcoming");
  expect(taskDeadlineState("2026-09-30T19:00:00+08:00", "open", now)).toEqual({
    state: "overdue",
    hours: 1,
  });
});
