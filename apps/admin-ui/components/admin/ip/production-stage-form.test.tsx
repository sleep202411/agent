// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProductionStageForm } from "./production-stage-form";
import { requestEnvelope } from "./shared";
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
        <ProductionStageForm ipId="ip-a" initial={{ stage: "testing", version: 0 }} canApprove />
      )
    );
    await act(async () => {
      const select = host.querySelector("select")!;
      select.value = "story_testing";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const reason = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        reason,
        "Reviewed production proposal."
      );
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(requestEnvelope).toHaveBeenCalledTimes(1);
    expect(host.querySelector("textarea")!.disabled).toBe(true);
    await act(async () => reject(new Error("Version changed. Refresh.")));
    expect(host.textContent).toContain("Version changed. Refresh.");
    expect(host.querySelector("textarea")!.value).toBe("Reviewed production proposal.");
    expect(host.querySelector("textarea")!.disabled).toBe(false);
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
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
        <ProductionStageForm
          ipId="ip"
          initial={{ stage: "production", version: 2 }}
          canApprove={false}
        />
      )
    );
    expect(host.textContent).toContain("Formal production");
    expect(host.querySelector("form")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
