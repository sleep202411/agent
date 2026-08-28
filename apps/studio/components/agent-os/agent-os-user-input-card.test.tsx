// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORY_VISUAL_STYLE_SKILLS } from "@repo/shared";

import type { AgentOsPendingUserInput } from "@/lib/agent-os/api-client";
import { AgentOsUserInputCard } from "./agent-os-user-input-card";

const request: AgentOsPendingUserInput = {
  kind: "user_input",
  requestId: "request-1",
  toolCallId: "call-1",
  questions: [
    {
      id: "ratio",
      header: "Aspect ratio",
      question: "Choose a frame.",
      options: [
        { value: "portrait_9_16", label: "9:16 portrait" },
        { value: "landscape_16_9", label: "16:9 landscape" },
      ],
    },
    {
      id: "language",
      header: "Story language",
      question: "Choose a language.",
      options: [
        { value: "en-US", label: "English" },
        { value: "zh-CN", label: "Simplified Chinese" },
      ],
    },
  ],
};

describe("AgentOsUserInputCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("uses native radio semantics, reports progress, and focuses each active question", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <AgentOsUserInputCard
          request={request}
          busy={false}
          labels={{
            step: (current, total) => `Step ${current} of ${total}`,
            back: "Back",
            continue: "Continue",
            submit: "Submit",
            submitting: "Submitting",
          }}
          onSubmit={onSubmit}
        />
      );
    });

    const progress = host.querySelector<HTMLElement>("[role='progressbar']");
    expect(progress?.getAttribute("aria-valuenow")).toBe("1");
    expect(progress?.getAttribute("aria-valuemax")).toBe("2");

    const firstGroup = host.querySelector<HTMLElement>("[role='radiogroup']");
    expect(firstGroup?.getAttribute("aria-required")).toBe("true");
    const firstRadios = Array.from(
      firstGroup?.querySelectorAll<HTMLInputElement>("input[type='radio']") ?? []
    );
    expect(firstRadios).toHaveLength(2);
    expect(firstRadios.every((radio) => radio.required)).toBe(true);
    expect(firstRadios.every((radio) => !radio.checked)).toBe(true);
    expect(document.activeElement).toBe(host.querySelector("legend"));

    const continueButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Continue"
    );
    expect(continueButton?.disabled).toBe(true);

    await act(async () => firstRadios[1]?.click());
    expect(firstRadios[1]?.checked).toBe(true);
    expect(continueButton?.disabled).toBe(false);

    await act(async () => continueButton?.click());

    expect(progress?.getAttribute("aria-valuenow")).toBe("2");
    const secondRadios = Array.from(
      host.querySelectorAll<HTMLInputElement>("[role='radiogroup'] input[type='radio']")
    );
    expect(secondRadios.every((radio) => !radio.checked)).toBe(true);
    expect(document.activeElement).toBe(host.querySelector("legend"));
    expect(host.textContent).toContain("Story language");
  });

  it("renders the complete Story visual-style catalog as unselected portrait covers", async () => {
    const onSubmit = vi.fn();
    const visualStyleRequest: AgentOsPendingUserInput = {
      kind: "user_input",
      requestId: "request-visual-style",
      toolCallId: "call-visual-style",
      formId: "story_creative_profile",
      questions: [
        {
          id: "visual_direction",
          header: "Visual style",
          question: "Choose a visual direction.",
          options: STORY_VISUAL_STYLE_SKILLS.map((style) => ({
            value: style.slug,
            label: style.slug,
          })),
        },
      ],
    };

    await act(async () => {
      root.render(
        <AgentOsUserInputCard
          request={visualStyleRequest}
          busy={false}
          labels={{
            step: (current, total) => `Step ${current} of ${total}`,
            back: "Back",
            continue: "Continue",
            submit: "Submit",
            submitting: "Submitting",
          }}
          resolveProfileOptionLabel={(_questionId, value) => `Localized ${value}`}
          onSubmit={onSubmit}
        />
      );
    });

    const covers = Array.from(host.querySelectorAll<HTMLImageElement>("img"));
    expect(covers).toHaveLength(12);
    expect(covers.every((cover) => !cover.className.includes("group-hover:scale"))).toBe(true);
    const visualStyleGroup = host.querySelector("[role='radiogroup']");
    expect(visualStyleGroup?.className).toContain("grid-cols-3");
    expect(visualStyleGroup?.className).toContain("overflow-y-auto");
    expect(visualStyleGroup?.className).toContain("max-h-[338px]");
    expect(
      covers.map((cover) => {
        const src = cover.getAttribute("src");
        if (!src) return null;
        return new URL(src, "http://localhost").searchParams.get("url") ?? src;
      })
    ).toEqual(
      STORY_VISUAL_STYLE_SKILLS.map(
        (style) => `/project-skills/previews/v1/${style.previewImageFile}`
      )
    );
    const radios = Array.from(host.querySelectorAll<HTMLInputElement>("input[type='radio']"));
    expect(host.textContent).toContain("Localized cinematic-realism");
    expect(radios.every((radio) => !radio.checked)).toBe(true);
    expect(
      radios.every((radio) => !radio.closest("label")?.className.includes("active:translate-y-px"))
    ).toBe(true);
    expect(
      radios.every(
        (radio) =>
          radio.closest("label")?.querySelector<HTMLElement>("span[aria-hidden]")?.style.padding ===
          "1.5px"
      )
    ).toBe(true);

    const submitButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Submit"
    );
    expect(submitButton?.disabled).toBe(true);

    await act(async () => radios[0]?.click());
    expect(submitButton?.disabled).toBe(false);
    const selectedRim = radios[0]
      ?.closest("label")
      ?.querySelector<HTMLElement>("span[aria-hidden]");
    expect(selectedRim?.style.backgroundImage).toBe("none");
    expect(selectedRim?.style.backgroundColor).toBe("rgba(229, 34, 39, 0.88)");
    await act(async () => submitButton?.click());
    expect(onSubmit).toHaveBeenCalledWith({ visual_direction: "cinematic-realism" });
  });
});
