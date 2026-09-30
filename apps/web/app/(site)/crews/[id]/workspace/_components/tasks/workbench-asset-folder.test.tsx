import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkbenchAssetFolder } from "./workbench-asset-folder";
import type { CrewAssetNodeDTO } from "../../_hooks/use-crew-assets";
const state = vi.hoisted(() => ({ queries: vi.fn() }));
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("../../_hooks/use-crew-assets", () => ({
  useCrewAssets: (crew: string, query: unknown, enabled: boolean) => {
    state.queries(crew, query, enabled);
    return { data: { items: [{ id: "file", name: "Episode.pdf", kind: "file" }] } };
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("loads a folder only when expanded and links its actual files", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    const asset = { id: "scripts", name: "Scripts", kind: "folder" } as CrewAssetNodeDTO;
    act(() => root.render(<WorkbenchAssetFolder crewId="crew" asset={asset} active />));
    expect(state.queries).toHaveBeenLastCalledWith(
      "crew",
      expect.objectContaining({ parentId: "scripts" }),
      false
    );
    expect(host.textContent).not.toContain("Episode.pdf");
    act(() => host.querySelector("button")!.click());
    expect(state.queries).toHaveBeenCalledWith(
      "crew",
      expect.objectContaining({ parentId: "scripts" }),
      true
    );
    expect([...host.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
      "?crew=crew&tab=assets&asset=scripts",
      "?crew=crew&tab=assets&asset=file",
    ]);
    expect(host.innerHTML).toContain("Episode.pdf");
    act(() => host.querySelector("button")!.click());
    expect(host.textContent).not.toContain("Episode.pdf");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
