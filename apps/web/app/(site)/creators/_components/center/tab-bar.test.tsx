import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CreatorTabBar, type CreatorTabId } from "./tab-bar";

vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function Harness() {
  const [active, setActive] = useState<CreatorTabId>("services");
  return <CreatorTabBar mode="tabs" active={active} onPick={setActive} />;
}

it("shows services first and preserves keyboard navigation", async () => {
  await act(async () => root.render(<Harness />));
  const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    "tabs.services",
    "tabs.ips",
    "tabs.works",
    "tabs.certificates",
    "tabs.crews",
  ]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  await act(async () =>
    tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
  );
  expect(tabs[4].getAttribute("aria-selected")).toBe("true");
  await act(async () =>
    tabs[4].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))
  );
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
});
