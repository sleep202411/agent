// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioAgentToolApprovalView } from "@/lib/studio-agent";

import {
  StudioAgentToolApproval,
  type StudioAgentToolApprovalLabels,
} from "./studio-agent-tool-approval";

/**
 * The gate the creator actually sees.
 *
 * The decision is the whole point: a row that renders the question but cannot
 * send an answer leaves the agent suspended for good, which is the state D1's
 * library-native path exists to end.
 */
describe("StudioAgentToolApproval", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("sends both answers, each exactly as the creator gave it", async () => {
    const onRespond = vi.fn();
    await render({ approval: pending(), onRespond });

    await act(async () => button("Approve")?.click());
    expect(onRespond).toHaveBeenLastCalledWith(true);

    await act(async () => button("Deny")?.click());
    expect(onRespond).toHaveBeenLastCalledWith(false);
  });

  it("reveals what the call will run with, and keeps it collapsed until asked", async () => {
    await render({ approval: pending(), onRespond: vi.fn() });
    expect(container.textContent).not.toContain("scene-1");

    await act(async () => button("Show what it will run with")?.click());
    expect(container.querySelector("pre")?.textContent).toContain("scene-1");
  });

  it("states the decision instead of vanishing, so the creator sees it registered", async () => {
    await render({ approval: { ...pending(), decision: "approved" }, onRespond: vi.fn() });

    expect(button("Approve")).toBeUndefined();
    expect(button("Deny")).toBeUndefined();
    expect(container.textContent).toContain("Approved");
    expect(container.textContent).toContain("Resuming the turn");
  });

  it("refuses the answer when the panel cannot write it", async () => {
    const onRespond = vi.fn();
    await render({ approval: pending(), onRespond, disabled: true });

    expect(button("Approve")?.disabled).toBe(true);
    await act(async () => button("Approve")?.click());
    expect(onRespond).not.toHaveBeenCalled();
  });

  function button(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
      candidate.textContent?.includes(label)
    );
  }

  async function render(props: {
    approval: StudioAgentToolApprovalView;
    onRespond: (approved: boolean) => void;
    disabled?: boolean;
  }) {
    await act(async () => {
      root.render(
        <StudioAgentToolApproval
          approval={props.approval}
          labels={labels}
          disabled={props.disabled}
          onRespond={props.onRespond}
        />
      );
    });
  }
});

function pending(): StudioAgentToolApprovalView {
  return {
    id: "approval-1",
    toolCallId: "call-1",
    toolName: "story.canvas.write",
    runId: "00000000-0000-4000-8000-000000000010",
    input: JSON.stringify({ sceneId: "scene-1" }, null, 2),
    decision: null,
  };
}

const labels: StudioAgentToolApprovalLabels = {
  title: (toolName) => `StoryOS wants to run ${toolName}.`,
  approve: "Approve",
  deny: "Deny",
  showInput: "Show what it will run with",
  hideInput: "Hide what it will run with",
  resuming: "Resuming the turn",
  decision: { approved: "Approved", denied: "Denied" },
};
