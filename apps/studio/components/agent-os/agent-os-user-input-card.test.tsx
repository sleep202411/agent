// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(document.activeElement).toBe(firstRadios[0]);

    await act(async () => firstRadios[1]?.click());
    expect(firstRadios[1]?.checked).toBe(true);

    const continueButton = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Continue"
    );
    await act(async () => continueButton?.click());

    expect(progress?.getAttribute("aria-valuenow")).toBe("2");
    const secondRadios = Array.from(
      host.querySelectorAll<HTMLInputElement>("[role='radiogroup'] input[type='radio']")
    );
    expect(document.activeElement).toBe(secondRadios[0]);
    expect(host.textContent).toContain("Story language");
  });
});
