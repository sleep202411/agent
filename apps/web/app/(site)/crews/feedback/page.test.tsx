import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Page from "./page";
const state = vi.hoisted(() => ({ user: null as null | { id: string }, isLoading: false }));
vi.mock("@/src/hooks/use-user", () => ({ useCurrentUser: () => state }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("../_components/crew-section-navigation", () => ({
  CrewSectionNavigation: ({ active }: { active: string }) => <nav>{active}</nav>,
}));
vi.mock("../_components/task-feedback-panel", () => ({
  TaskFeedbackPanel: () => <section data-testid="private-history" />,
}));
it.each([
  { user: null, isLoading: false, expected: "signIn", visible: false },
  { user: { id: "departed" }, isLoading: true, expected: "loading", visible: false },
  { user: { id: "departed" }, isLoading: false, expected: "history", visible: true },
])("gates personal history for $expected", async (input) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(state, input);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<Page />));
    expect(host.textContent).toContain(input.expected);
    expect(Boolean(host.querySelector('[data-testid="private-history"]'))).toBe(input.visible);
    expect(host.querySelector("nav")?.textContent).toBe("feedback");
  } finally {
    await act(async () => root.unmount());
  }
});
