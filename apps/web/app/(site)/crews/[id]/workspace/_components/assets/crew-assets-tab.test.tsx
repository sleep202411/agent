// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CrewAssetsTab } from "./crew-assets-tab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/src/i18n/i18n", async () => {
  const messages = (await import("@/messages/en-US.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslations: (namespace: string) => (key: string, vars?: Record<string, string | number>) =>
      Object.entries(vars ?? {}).reduce<string>(
        (copy, [name, value]) => copy.replaceAll(`{${name}}`, String(value)),
        messages[namespace]?.[key] ?? key
      ),
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

vi.mock("@/components/user-avatar", () => ({
  UserAvatar: ({ name }: { name: string }) => <span aria-label={name} />,
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<CrewAssetsTab crewId="crew_1" />));
}

function assetRow(name: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('[role="button"]')].find((element) =>
    element.textContent?.includes(name)
  );
  if (!row) throw new Error(`Asset row not found: ${name}`);
  return row;
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("asset preview interaction", () => {
  it("updates the in-page preview region when an asset is selected", () => {
    render();

    const row = assetRow("EP01_Scrt_010_board_v02.pdf");
    click(row);

    const preview = document.querySelector<HTMLElement>(
      'aside[aria-label="Asset preview and details"]'
    );
    expect(row.className).toContain("bg-primary/8");
    expect(preview?.textContent).toContain("EP01_Scrt_010_board_v02.pdf");
    expect(preview?.querySelector('img[alt="EP01_Scrt_010_board_v02.pdf"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("closes and reopens the right preview region without an overlay", () => {
    render();

    const closeButton = document.querySelector<HTMLElement>('button[aria-label="Close preview"]');
    if (!closeButton) throw new Error("Close preview button not found");
    click(closeButton);

    expect(document.querySelector('aside[aria-label="Asset preview and details"]')).toBeNull();

    const toggleButton = document.querySelector<HTMLElement>(
      'button[aria-label="Toggle preview panel"]'
    );
    if (!toggleButton) throw new Error("Toggle preview button not found");
    click(toggleButton);

    expect(document.querySelector('aside[aria-label="Asset preview and details"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });
});
