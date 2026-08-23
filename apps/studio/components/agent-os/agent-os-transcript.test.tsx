// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentOsActivityIndicator, AgentOsTranscript } from "./agent-os-transcript";
import type { AgentOsChatMessage, AgentOsSessionStatus } from "./use-agent-os-run";

const labels = {
  transcript: "Conversation",
  scrollToLatest: "Scroll to latest",
  user: "You",
  assistant: "FizzAgent",
  thinking: "Thinking",
  waitingForInput: "Waiting for your answer",
  waitingForApproval: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
};

const messages: AgentOsChatMessage[] = [
  {
    id: "user-current",
    role: "user",
    content: "Continue",
    createdAt: "2026-08-21T00:00:00.000Z",
    turnId: "turn-current",
    runId: "run-current",
  },
];

describe("AgentOsActivityIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps HITL status visible without implying that execution is still running", async () => {
    await act(async () => {
      root.render(<AgentOsActivityIndicator label="Waiting for your answer" waiting />);
    });

    const status = container.querySelector<HTMLElement>("[role='status']");
    expect(status?.dataset.activityMode).toBe("waiting");
    expect(status?.textContent).toBe("Waiting for your answer");
    expect(status?.querySelector(".tabler-icon-clock-pause")).not.toBeNull();
    expect(status?.querySelector(".animate-spin")).toBeNull();
    expect(status?.getAttribute("aria-live")).toBe("polite");
  });

  it("uses the working indicator only while the Agent is executing", async () => {
    await act(async () => {
      root.render(<AgentOsActivityIndicator label="Thinking" />);
    });

    const status = container.querySelector<HTMLElement>("[role='status']");
    expect(status?.dataset.activityMode).toBe("working");
    expect(status?.querySelector(".tabler-icon-loader-2.animate-spin")).not.toBeNull();
  });

  it.each(["completed", "failed", "cancelled"] as AgentOsSessionStatus[])(
    "does not render explicit activity after the run is %s",
    async (status) => {
      await act(async () => {
        root.render(
          <AgentOsTranscript
            messages={messages}
            status={status}
            error={null}
            busy={false}
            activityStatus={{ label: "Late host activity", turnId: "turn-current" }}
            labels={labels}
            empty={null}
          />
        );
      });

      expect(container.querySelector("[role='status']")).toBeNull();
      expect(container.textContent).not.toContain("Late host activity");
    }
  );

  it("ignores activity from an older turn and only renders the current turn", async () => {
    await act(async () => {
      root.render(
        <AgentOsTranscript
          messages={messages}
          status="waiting_for_external"
          error={null}
          busy={false}
          activityStatus={{ label: "Old turn activity", turnId: "turn-old" }}
          labels={labels}
          empty={null}
        />
      );
    });

    expect(container.textContent).not.toContain("Old turn activity");
    expect(container.querySelector("[role='status']")?.textContent).toBe("Thinking");
    expect(container.querySelector("[data-turn-id='turn-old']")).toBeNull();

    await act(async () => {
      root.render(
        <AgentOsTranscript
          messages={messages}
          status="waiting_for_external"
          error={null}
          busy={false}
          activityStatus={{ label: "Current turn activity", turnId: "turn-current" }}
          labels={labels}
          empty={null}
        />
      );
    });

    expect(container.querySelector("[role='status']")?.textContent).toBe("Current turn activity");
    expect(container.querySelector("[data-turn-id='turn-current']")).not.toBeNull();
  });
});
