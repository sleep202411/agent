import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SiteRegionSwitcher } from "./site-region-switcher";
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({ usePathname: () => "/projects" }));
vi.mock("./region-provider", () => ({ useSiteRegion: () => "global" }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <button onClick={() => onOpenChange(true)}>Open</button>
      {children}
    </div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  DropdownMenuSeparator: () => <hr />,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("refreshes query and hash when opened after same-path navigation", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const original = window.location.href;
  try {
    window.history.replaceState(null, "", "/projects?tab=old");
    await act(async () => root.render(<SiteRegionSwitcher />));
    window.history.replaceState(null, "", "/projects?tab=current#selected");
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector("a")!.href).toBe(
      "https://studio.fizzspace.cn/en-US/projects?tab=current#selected"
    );
  } finally {
    await act(async () => root.unmount());
    window.history.replaceState(null, "", original);
  }
});
