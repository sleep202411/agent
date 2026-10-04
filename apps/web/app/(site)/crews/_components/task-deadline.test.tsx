import { expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TaskDeadline, TaskStateBadge, taskDeadlineState } from "./task-deadline";
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, values?: { count: number }) => `${key}:${values?.count}`,
}));
const now = Date.parse("2026-09-13T00:00:00Z");
afterEach(() => vi.useRealTimers());
it("distinguishes overdue, configurable warning windows, closed and invalid deadlines", () => {
  expect(taskDeadlineState(null, "open", now)).toBeNull();
  expect(taskDeadlineState("invalid", "open", now)).toBeNull();
  expect(taskDeadlineState("2026-09-12T23:00:00Z", "open", now)).toEqual({
    state: "overdue",
    hours: 1,
  });
  expect(taskDeadlineState("2026-09-15T00:00:00Z", "open", now)).toEqual({
    state: "soon",
    hours: 48,
  });
  expect(taskDeadlineState("2026-09-15T00:00:00Z", "open", now, 24)?.state).toBe("upcoming");
  for (const status of ["approved", "cancelled"])
    expect(taskDeadlineState("2026-09-12T00:00:00Z", status, now)?.state).toBe("closed");
});
it("turns a visible task overdue as time passes and releases its timer", () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div");
  const root = createRoot(element);
  act(() => root.render(<TaskDeadline dueAt="2026-09-13T00:00:30Z" status="open" />));
  expect(element.textContent).toContain("soon:1");
  act(() => vi.advanceTimersByTime(60_000));
  expect(element.textContent).toContain("overdue:1");
  expect(element.querySelector("time")?.className).toContain("text-red-300");
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});

it("shows three-day urgency and overdue states without marking submitted work late", () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const element = document.createElement("div"),
    root = createRoot(element);
  act(() =>
    root.render(
      <TaskStateBadge dueAt="2026-09-16T00:00:00Z" status="in_progress" label="In progress" />
    )
  );
  expect(element.textContent).toContain("urgentLabel");
  expect(element.firstElementChild?.className).toContain("text-amber-300");
  act(() =>
    root.render(
      <TaskStateBadge dueAt="2026-09-12T00:00:00Z" status="in_progress" label="In progress" />
    )
  );
  expect(element.textContent).toContain("overdueLabel");
  act(() =>
    root.render(
      <TaskStateBadge dueAt="2026-09-12T00:00:00Z" status="submitted" label="Awaiting review" />
    )
  );
  expect(element.textContent).toBe("Awaiting review");
  act(() => root.unmount());
});
