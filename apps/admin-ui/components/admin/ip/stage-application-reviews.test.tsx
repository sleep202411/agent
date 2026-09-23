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

it("shows refreshed applications and keeps notes only for the same pending application", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const application = {
    id: "first",
    stage: "production",
    status: "pending",
    reason: "First proposal",
    reviewReason: null,
    applicantId: "owner",
  };
  const render = async (initial: (typeof application)[]) => {
    await act(async () =>
      root.render(<StageApplicationReviews ipId="ip" initial={initial} canReview />)
    );
  };
  try {
    await render([application]);
    await act(async () => {
      const input = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        "Review for first"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render([{ ...application, reason: "Refreshed proposal" }]);
    expect(host.textContent).toContain("Refreshed proposal");
    expect(host.querySelector("textarea")!.value).toBe("Review for first");
    await render([{ ...application, id: "second", reason: "Second proposal" }]);
    expect(host.textContent).toContain("Second proposal");
    expect(host.querySelector("textarea")!.value).toBe("");
    expect(host.querySelector("button")!.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});
it("removes review controls when refreshed data says another admin already reviewed", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const application = {
    id: "app",
    stage: "production",
    status: "pending",
    reason: "Proposal",
    reviewReason: null as string | null,
    applicantId: "owner",
  };
  try {
    await act(async () =>
      root.render(<StageApplicationReviews ipId="ip" initial={[application]} canReview />)
    );
    await act(async () =>
      root.render(
        <StageApplicationReviews
          ipId="ip"
          initial={[{ ...application, status: "approved", reviewReason: "Approved elsewhere" }]}
          canReview
        />
      )
    );
    expect(host.textContent).toContain("Approved elsewhere");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("keeps a successful local review visible while awaiting refresh, then accepts the new list", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const application = {
    id: "app",
    stage: "production",
    status: "pending",
    reason: "Proposal",
    reviewReason: null as string | null,
    applicantId: "owner",
  };
  vi.mocked(requestEnvelope).mockResolvedValueOnce({
    ...application,
    status: "approved",
    reviewReason: "Local approval",
  });
  try {
    await act(async () =>
      root.render(<StageApplicationReviews ipId="ip" initial={[application]} canReview />)
    );
    await act(async () => {
      const input = host.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        "Local approval"
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("Local approval");
    expect(host.querySelector("button")).toBeNull();
    await act(async () =>
      root.render(
        <StageApplicationReviews
          ipId="ip"
          initial={[{ ...application, id: "new", stage: "released", reason: "New application" }]}
          canReview
        />
      )
    );
    expect(host.textContent).toContain("New application");
    expect(host.querySelector("textarea")!.value).toBe("");
    expect(host.textContent).not.toContain("Local approval");
  } finally {
    await act(async () => root.unmount());
  }
});
