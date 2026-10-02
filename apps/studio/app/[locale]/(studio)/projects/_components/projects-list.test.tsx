// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { it, vi, expect } from "vitest";
import { ProjectsList } from "./projects-list";
const s = vi.hoisted(() => ({
  resolve: () => {},
  items: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ],
  refresh: vi.fn(async () => {}),
  error: null as Error | null,
  pending: false,
  retry: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: s.items,
    error: s.error,
    isPending: s.pending,
    isFetching: false,
    refetch: s.retry,
  }),
  useQueryClient: () => ({ invalidateQueries: s.refresh }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US", useTranslations: () => (k: string) => k }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/_components/auth-provider", () => ({ useAuth: () => ({ user: { id: "user" } }) }));
vi.mock("@/app/_components/region-provider", () => ({ useSiteRegion: () => "global" }));
vi.mock("@/lib/web-base", () => ({ getWebBaseUrl: () => "" }));
vi.mock("@/lib/legacy-projects", () => ({
  listMyLegacyProjects: vi.fn(),
  renameLegacyProject: () =>
    new Promise<void>((r) => {
      s.resolve = r;
    }),
  deleteLegacyProject: () =>
    new Promise<void>((r) => {
      s.resolve = r;
    }),
}));
vi.mock("@/components/project-card", () => ({
  ProjectCard: ({ name, menu }: { name: string; menu: ReactNode }) =>
    createElement("article", { "data-name": name }, menu),
}));
vi.mock("@/components/ui/section-heading", () => ({ SectionHeading: () => null }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement("section", { role: "dialog" }, children) : null,
  DialogContent: ({ children }: { children: ReactNode }) => children,
  DialogDescription: () => null,
  DialogFooter: ({ children }: { children: ReactNode }) => children,
  DialogHeader: ({ children }: { children: ReactNode }) => children,
  DialogTitle: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => children,
  DropdownMenuTrigger: () => null,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ onSelect, children }: { onSelect: () => void; children: ReactNode }) =>
    createElement("button", { onClick: onSelect }, children),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each([
  ["rename", "A"],
  ["rename", "B"],
  ["delete", "A"],
  ["delete", "B"],
  ["rename", null],
  ["delete", null],
])("late %s respects dialog ownership (replacement=%s)", async (action, replacement) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const click = async (scope: Element, label: string) => {
    const button = Array.from(scope.querySelectorAll("button")).find(
      (b) => b.textContent === label
    )!;
    await act(async () => button.click());
  };
  try {
    await act(async () => root.render(createElement(ProjectsList)));
    await click(host.querySelector('[data-name="A"]')!, action!);
    await click(host.querySelector('[role="dialog"]')!, action === "rename" ? "save" : "delete");
    if (replacement) {
      await click(host.querySelector('[role="dialog"]')!, "cancel");
      await click(host.querySelector(`[data-name="${replacement}"]`)!, action!);
    }
    await act(async () => s.resolve());
    expect(host.querySelector('[role="dialog"]') !== null).toBe(replacement !== null);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each([false, true])(
  "shows a read error and retries without discarding cached projects (cached=%s)",
  async (cached) => {
    const original = s.items;
    s.items = cached ? original : [];
    s.error = new Error("Project service unavailable");
    s.retry.mockClear();
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(ProjectsList)));
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("Project service unavailable");
      expect(host.querySelectorAll("article").length).toBe(cached ? 2 : 0);
      const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "retry")!;
      await act(async () => retry.click());
      expect(s.retry).toHaveBeenCalledTimes(1);
      s.error = null;
      s.items = original;
      await act(async () => root.render(createElement(ProjectsList)));
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelectorAll("article").length).toBe(2);
    } finally {
      await act(async () => root.unmount());
      s.items = original;
      s.error = null;
    }
  }
);
