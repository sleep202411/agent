import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LevelBadge } from "./left-rail";

it("recovers badge artwork when a missing or failed image URL is replaced", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (iconUrl: string) =>
    act(async () =>
      root.render(
        <TooltipProvider>
          <ul>
            <LevelBadge level={{ id: 1, name: "AI Producer", description: "", iconUrl }} />
          </ul>
        </TooltipProvider>
      )
    );
  try {
    await render("");
    expect(host.querySelector("img")).toBeNull();
    await render("https://example.com/first.png");
    expect(host.querySelector("img")?.getAttribute("src")).toContain("first.png");
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.querySelector("img")).toBeNull();
    await render("https://example.com/repaired.png");
    expect(host.querySelector("img")?.getAttribute("src")).toContain("repaired.png");
  } finally {
    await act(async () => root.unmount());
  }
});
