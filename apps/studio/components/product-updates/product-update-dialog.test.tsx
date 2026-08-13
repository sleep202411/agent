// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductUpdateDialog } from "./product-update-dialog";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("ProductUpdateDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function renderDialog(onCta = vi.fn()) {
    root.render(
      <ProductUpdateDialog
        announcementId="skills-v1"
        title="Skills are here"
        description="Reusable direction"
        ctaLabel="Explore Skills"
        closeLabel="Close announcement"
        muteLabel="Mute preview"
        unmuteLabel="Unmute preview"
        media={{ type: "image", src: "/skill.jpg", alt: "Skill preview" }}
        onCta={onCta}
      />
    );
    return onCta;
  }

  it("shows an unseen release and records dismissal by announcement id", async () => {
    await act(async () => renderDialog());
    await act(async () => new Promise(requestAnimationFrame));

    expect(document.body.textContent).toContain("Skills are here");
    const close = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Close announcement"]'
    );
    await act(async () => close?.click());

    expect(localStorage.getItem("fizzdragon:product-update:skills-v1")).toBe("seen");
    expect(document.body.textContent).not.toContain("Skills are here");
  });

  it("does not show an already seen release", async () => {
    localStorage.setItem("fizzdragon:product-update:skills-v1", "seen");
    await act(async () => renderDialog());
    await act(async () => new Promise(requestAnimationFrame));

    expect(document.body.textContent).not.toContain("Skills are here");
  });

  it("dismisses and invokes the primary action", async () => {
    const onCta = vi.fn();
    await act(async () => renderDialog(onCta));
    await act(async () => new Promise(requestAnimationFrame));
    const cta = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Explore Skills")
    );
    await act(async () => cta?.click());

    expect(onCta).toHaveBeenCalledOnce();
    expect(localStorage.getItem("fizzdragon:product-update:skills-v1")).toBe("seen");
  });
});
