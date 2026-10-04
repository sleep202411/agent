// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en-US.json";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoryPublicationStatus } from "./story-publication-status";

let host: HTMLDivElement, root: Root;
const retry = vi.fn(),
  signIn = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
async function render(error: unknown, refetching = false) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        <TooltipProvider delayDuration={0}>
          <StoryPublicationStatus
            publication={null}
            pending={false}
            error={error}
            refetching={refetching}
            onRetry={retry}
            onSignIn={signIn}
          />
        </TooltipProvider>
      </NextIntlClientProvider>
    )
  );
}
async function hover() {
  const button = host.querySelector("button")!;
  await act(async () => {
    const event = new MouseEvent("pointermove", { bubbles: true });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    button.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.textContent === text
  )!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
}

describe("publication status recovery", () => {
  it("explains expired sessions on hover and provides a sign-in action on click", async () => {
    await render(
      Object.assign(Error("Session has expired upstream."), {
        status: 401,
        code: "STORY_PUBLICATION_SESSION_EXPIRED",
      })
    );
    expect(host.textContent).toBe("Sign in required");
    await hover();
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain("Your session has expired. Sign in again");
    expect(tooltip?.textContent).toContain("Session has expired upstream.");
    await click("Sign in required");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Session has expired upstream."
    );
    await click("Sign in again");
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("explains project access denial and retains actionable upstream details", async () => {
    await render(
      Object.assign(Error("story.read denied for this project"), {
        status: 403,
        code: "STORY_PERMISSION_DENIED",
      })
    );
    await hover();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "Ask the project owner to check your access"
    );
    await click("Access required");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "story.read denied for this project"
    );
    await click("Retry publication status");
    expect(retry).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain("Sign in again");
  });

  it("shows upstream authorization failures as service problems rather than player role failures", async () => {
    await render(
      Object.assign(Error("Upstream token forbidden"), {
        status: 502,
        code: "STORY_PUBLICATION_UPSTREAM_FAILED",
      })
    );
    expect(host.textContent).toBe("Publication service error");
    await hover();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("contact support");
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "Upstream token forbidden"
    );
    expect(document.body.textContent).not.toContain("Ask the project owner");
  });

  it("keeps retry disabled while the status request is already in flight", async () => {
    await render(Error("Gateway offline"), true);
    await click("Publication service error");
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (node) => node.textContent === "Checking publication status…"
    )!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(retry).not.toHaveBeenCalled();
  });
});
