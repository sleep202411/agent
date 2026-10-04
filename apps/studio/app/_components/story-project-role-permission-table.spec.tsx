// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import type { AssignableShareRole } from "@/lib/collab/sharing-api";
import { StoryProjectRolePermissionTable } from "./story-project-role-permission-table";

let root: Root, host: HTMLDivElement, focusTarget: HTMLButtonElement;
let viewportWidth: number;
let resized: () => void;
const disconnected = vi.fn();
const positions: Record<string, number> = {
  owner: 160,
  producer: 264,
  editor: 368,
  reviewer: 472,
  viewer: 576,
};

beforeEach(() => {
  viewportWidth = 320;
  disconnected.mockClear();
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.getAttribute("role") === "region" ? viewportWidth : 0;
  });
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this.getAttribute("role") === "region" ? 680 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    return positions[this.dataset.role ?? ""] ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement
  ) {
    return this.dataset.role ? 104 : 160;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = vi.fn();
      disconnect = disconnected;
    }
  );
  host = document.createElement("div");
  focusTarget = document.createElement("button");
  document.body.append(focusTarget, host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  focusTarget.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const render = (role: AssignableShareRole) =>
  act(async () =>
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
        <StoryProjectRolePermissionTable selectedRole={role} source="member" />
      </NextIntlClientProvider>
    )
  );

describe("Mobile role comparison visibility", () => {
  it("reveals the selected column on mount, role change and resize while preserving focus and manual scrolling", async () => {
    focusTarget.focus();
    await render("viewer");
    const region = host.querySelector<HTMLElement>('[role="region"]')!;
    expect(region.scrollLeft).toBe(360);
    expect(document.activeElement).toBe(focusTarget);
    const hint = document.getElementById(region.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toBe("Swipe horizontally to compare roles.");

    region.scrollLeft = 50;
    await act(async () => region.dispatchEvent(new Event("scroll")));
    expect(region.scrollLeft).toBe(50);
    await render("viewer");
    expect(region.scrollLeft).toBe(50);

    region.scrollLeft = 350;
    await render("producer");
    expect(region.scrollLeft).toBe(104);
    const producer = host.querySelector<HTMLElement>('th[data-role="producer"]')!;
    expect(producer.offsetLeft - region.scrollLeft).toBe(160);
    expect(producer.offsetLeft + producer.offsetWidth - region.scrollLeft).toBeLessThanOrEqual(
      viewportWidth
    );
    expect(document.activeElement).toBe(focusTarget);

    region.scrollLeft = 350;
    viewportWidth = 300;
    await act(async () => resized());
    expect(region.scrollLeft).toBe(104);
    expect(producer.offsetLeft + producer.offsetWidth - region.scrollLeft).toBeLessThanOrEqual(
      viewportWidth
    );
    expect(disconnected).toHaveBeenCalledOnce();
  });
});
