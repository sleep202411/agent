import { describe, expect, it } from "vitest";

import { agentActivityLabelKey, resolveAgentOsActivityStatus } from "./agent-os-activity";

describe("agentActivityLabelKey", () => {
  it("maps internal tool ids to product language keys", () => {
    expect(agentActivityLabelKey({ kind: "tool", toolId: "story.read" })).toBe("readingStory");
    expect(agentActivityLabelKey({ kind: "tool", toolId: "story.author" })).toBe(
      "preparingStoryDraft"
    );
    expect(agentActivityLabelKey({ kind: "tool", toolId: "canvas.applyPatch" })).toBe(
      "updatingCanvas"
    );
  });

  it("never requires an unknown raw tool id as visible copy", () => {
    expect(agentActivityLabelKey({ kind: "tool", toolId: "project.inspectUnknown" })).toBe(
      "readingProject"
    );
    expect(agentActivityLabelKey({ kind: "tool", toolId: "project.mutateUnknown" })).toBe(
      "updatingProject"
    );
  });

  it("maps HITL waits to localizable product copy", () => {
    expect(agentActivityLabelKey({ kind: "waiting_for_input" })).toBe("waitingForInput");
    expect(agentActivityLabelKey({ kind: "waiting_for_approval" })).toBe("waitingForApproval");
  });
});

describe("resolveAgentOsActivityStatus", () => {
  const derived = {
    label: "Thinking",
    mode: "working" as const,
    runId: "agent-run-1",
    turnId: "turn-current",
  };

  it.each(["completed", "failed", "cancelled"] as const)(
    "never exposes host activity after a durable %s terminal",
    (status) => {
      expect(
        resolveAgentOsActivityStatus({
          status,
          runId: "agent-run-1",
          activeTurnId: "turn-current",
          pendingExternalJobId: "story-run-1",
          host: {
            label: "Applying story",
            externalJobId: "story-run-1",
            turnId: "turn-current",
          },
          derived,
        })
      ).toBeNull();
    }
  );

  it("pins a correlated host status to the current run and turn", () => {
    expect(
      resolveAgentOsActivityStatus({
        status: "waiting_for_external",
        runId: "agent-run-1",
        activeTurnId: "turn-current",
        pendingExternalJobId: "story-run-1",
        host: { label: "Writing scenes", externalJobId: "story-run-1" },
        derived,
      })
    ).toEqual({
      label: "Writing scenes",
      externalJobId: "story-run-1",
      runId: "agent-run-1",
      turnId: "turn-current",
    });
  });

  it("rejects stale host work instead of binding it to another turn", () => {
    expect(
      resolveAgentOsActivityStatus({
        status: "waiting_for_external",
        runId: "agent-run-1",
        activeTurnId: "turn-current",
        pendingExternalJobId: "story-run-1",
        host: {
          label: "Stale apply",
          externalJobId: "story-run-1",
          turnId: "turn-old",
        },
        derived,
      })
    ).toEqual(derived);
    expect(
      resolveAgentOsActivityStatus({
        status: "waiting_for_external",
        runId: "agent-run-1",
        activeTurnId: "turn-current",
        pendingExternalJobId: "story-run-1",
        host: { label: "Another job", externalJobId: "story-run-2" },
        derived: null,
      })
    ).toBeNull();
  });
});
