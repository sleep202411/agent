import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en-US.json";
import cn from "@/messages/zh-CN.json";
import hk from "@/messages/zh-HK.json";
import { CrewEligibilityNotice } from "./crew-eligibility-notice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ locale: "en-US" }));
const dictionaries = { "en-US": en, "zh-CN": cn, "zh-HK": hk };
vi.mock("@/src/i18n/i18n", () => ({
  useTranslations: () => (key: string) => {
    const copy = dictionaries[state.locale as keyof typeof dictionaries].crew.creationRequirements;
    return copy[key as keyof typeof copy];
  },
  useLocale: () => state.locale,
}));
vi.mock("@/app/(site)/creators/_components/center/dialogs/level-apply-dialog", () => ({
  AI_PRODUCER_LEVEL_ID: 13,
  LevelApplyDialog: () => null,
}));
const container = document.createElement("div");
document.body.appendChild(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  document.querySelectorAll("[data-notice-opener]").forEach((element) => element.remove());
  root = createRoot(container);
});

describe("isolated Crew qualification notice", () => {
  it.each(["en-US", "zh-CN", "zh-HK"] as const)(
    "renders and dismisses %s with a usable email link",
    async (locale) => {
      state.locale = locale;
      const copy = dictionaries[locale].crew.creationRequirements;
      const change = vi.fn();
      const opener = document.createElement("button");
      opener.setAttribute("data-notice-opener", "");
      document.body.appendChild(opener);
      opener.focus();
      await act(async () => root.render(<CrewEligibilityNotice open onOpenChange={change} />));
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
      expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe(
        copy.title
      );
      expect(document.getElementById(dialog.getAttribute("aria-describedby")!)?.textContent).toBe(
        copy.eligibility
      );
      expect(dialog.textContent).toContain(copy.instructions);
      expect(dialog.textContent).toContain("FizzDragon");
      const link = dialog.querySelector("a")!;
      const url = new URL(link.href);
      expect(url.protocol).toBe("mailto:");
      expect(url.pathname).toBe("business@fizzdragon.com");
      expect(url.searchParams.get("subject")).toBe(copy.subject);
      const buttons = Array.from(dialog.querySelectorAll("button"));
      const dismiss = buttons.find((button) => button.textContent === copy.dismiss);
      expect(dismiss).toBeTruthy();
      expect(buttons.some((button) => button.textContent === copy.applyCta)).toBe(true);
      await act(async () => dismiss!.click());
      expect(change).toHaveBeenCalledWith(false);
      await act(async () =>
        root.render(<CrewEligibilityNotice open={false} onOpenChange={change} />)
      );
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(opener));
      opener.remove();
    }
  );
  it("supports Escape through the shared dialog", async () => {
    const change = vi.fn();
    await act(async () => root.render(<CrewEligibilityNotice open onOpenChange={change} />));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(change).toHaveBeenCalledWith(false);
  });
  it("opens apply flow from the primary CTA without closing the parent gate", async () => {
    state.locale = "en-US";
    const copy = dictionaries["en-US"].crew.creationRequirements;
    const change = vi.fn();
    await act(async () => root.render(<CrewEligibilityNotice open onOpenChange={change} />));
    const dialog = document.querySelector('[role="dialog"]')!;
    const apply = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === copy.applyCta
    );
    expect(apply).toBeTruthy();
    await act(async () => apply!.click());
    expect(change).not.toHaveBeenCalled();
  });
});
