import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
const h = vi.hoisted(() => ({
  error: false,
  next: false,
  items: [] as Record<string, unknown>[],
  refetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "crew", positionId: "selected" }) }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));
vi.mock("../../../_hooks/use-crew", () => ({
  useCrewDetail: () => ({ data: { id: "crew", name: "Film crew" }, refetch: h.refetch }),
  useCrewPositions: () => ({
    data: h.items,
    isError: h.error,
    error: h.error ? new Error("Unavailable") : null,
    hasNextPage: h.next,
    refetch: h.refetch,
  }),
}));
vi.mock("../../../_hooks/use-crew-permissions", () => ({
  useCrewPermissions: () => ({ isMember: false }),
}));
vi.mock("../../../_hooks/use-position-label", () => ({
  useTranslatePositionValue: () => (value: string) => value,
}));
vi.mock("../../../_components/crew-section-navigation", () => ({
  CrewSectionNavigation: () => null,
}));
vi.mock("../../../_components/apply-position-dialog", () => ({
  ApplyPositionDialog: ({ open, positionId }: { open: boolean; positionId: string }) =>
    open ? <div data-application={positionId} /> : null,
}));
let root: Root, host: HTMLDivElement;
const selected = {
  id: "selected",
  positionType: "Editor",
  description: "Deliver the selected film edit",
  status: "open",
  targetCount: 1,
  recruitedCount: 0,
  employmentType: "contract",
  experienceLevel: "any",
  workMode: "remote",
  salary: { negotiable: true },
  requiredSkills: ["Editing"],
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.error = false;
  h.next = false;
  h.items = [
    selected,
    { ...selected, id: "other", positionType: "Composer", description: "Other role" },
  ];
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("shows only the selected opening and applies to that exact position", () => {
  act(() => root.render(<Page />));
  expect(host.textContent).toContain(selected.description);
  expect(host.textContent).not.toContain("Other role");
  expect(host.querySelector('a[href="/zh-CN/crews?view=positions"]')).not.toBeNull();
  act(() =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "ctaApply")!.click()
  );
  expect(host.querySelector('[data-application="selected"]')).not.toBeNull();
});
it("does not expose stale details or an application form after a fetch error", () => {
  act(() => root.render(<Page />));
  act(() =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "ctaApply")!.click()
  );
  h.error = true;
  act(() => root.render(<Page />));
  expect(host.textContent).not.toContain(selected.description);
  expect(host.querySelector("[data-application]")).toBeNull();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it("waits for remaining position pages before declaring a link unavailable", () => {
  h.items = [];
  h.next = true;
  act(() => root.render(<Page />));
  expect(host.textContent).toContain("loading");
  expect(host.textContent).not.toContain("unavailable");
  h.next = false;
  act(() => root.render(<Page />));
  expect(host.textContent).toContain("unavailable");
});
it.each(["frozen", "private"])("does not display %s openings", (kind) => {
  h.items = [
    {
      ...selected,
      ...(kind === "private" ? { recruitmentVisibility: "private" } : { status: "frozen" }),
    },
  ];
  act(() => root.render(<Page />));
  expect(host.textContent).not.toContain(selected.description);
  expect(host.querySelector("[data-application]")).toBeNull();
});
