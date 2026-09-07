// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { RegionProvider, useSiteRegion } from "./region-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
function Site() {
  return <span>{useSiteRegion()}</span>;
}
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

it.each(["cn", "global"] as const)("keeps the configured %s site regardless of country", (site) => {
  act(() =>
    root.render(
      <RegionProvider country="CN" siteRegion={site}>
        <Site />
      </RegionProvider>
    )
  );
  expect(container.textContent).toBe(site);
});

it("does not silently choose the international site outside the provider", () => {
  expect(() => act(() => root.render(<Site />))).toThrow("RegionProvider");
});
