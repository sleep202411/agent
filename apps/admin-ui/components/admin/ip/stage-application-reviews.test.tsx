// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StageApplicationReviews } from "./stage-application-reviews";
import { requestEnvelope } from "./shared";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./shared", () => ({ requestEnvelope: vi.fn(), toErrorMessage: (e: Error) => e.message }));
vi.stubGlobal("React", React);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());

it("retains a failed review, prevents duplicate starts and cancels an abandoned retry", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let reject!: (error: Error) => void;
  vi.mocked(requestEnvelope).mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      })
  );
  try {
    await act(async () =>
      root.render(
        <StageApplicationReviews
          ipId="ip-a"
          initial={[
            {
              id: "app",
              stage: "production",
              status: "pending",
              reason: "Proposal",
              reviewReason: null,
              applicantId: "owner",
            },
          ]}
          canReview
        />
      )
    );
    await act(async () => {
      const reason = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        reason,
        "Reviewed production proposal."
      );
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("button")!.click();
      host.querySelector("button")!.click();
    });
    expect(requestEnvelope).toHaveBeenCalledTimes(1);
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    await act(async () => reject(new Error("Version changed. Refresh.")));
    expect(host.textContent).toContain("Version changed. Refresh.");
    expect(host.querySelector("textarea")!.value).toBe("Reviewed production proposal.");
    expect(host.querySelector("textarea")!.disabled).toBe(false);
    await act(async () => {
      host.querySelector("button")!.click();
    });
    const signal = vi.mocked(requestEnvelope).mock.calls[1][1]?.signal;
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    await act(async () => reject(new Error("Late error")));
    expect(host.textContent).toBe("");
  } finally {
    host.remove();
  }
});

it("shows the stage without approval controls to a read-only administrator", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <StageApplicationReviews
          ipId="ip"
          initial={[
            {
              id: "app",
              stage: "production",
              status: "pending",
              reason: "Proposal",
              reviewReason: null,
              applicantId: "owner",
            },
          ]}
          canReview={false}
        />
      )
    );
    expect(host.textContent).toContain("Formal production");
    expect(host.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
