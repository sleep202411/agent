import { describe, expect, it } from "vitest";

import { agentTaskQueues } from "./task-queues.js";

describe("agentTaskQueues", () => {
  it("derives stable isolated execution lanes from one deployment queue", () => {
    expect(agentTaskQueues("fizzdragon-agent")).toEqual({
      workflow: "fizzdragon-agent",
      control: "fizzdragon-agent-control",
      inference: "fizzdragon-agent-inference",
      tool: "fizzdragon-agent-tool",
      lifecycle: "fizzdragon-agent-lifecycle",
      cleanup: "fizzdragon-agent-cleanup",
      document: "fizzdragon-agent-document",
    });
  });

  it("rejects an empty or unbounded base queue", () => {
    expect(() => agentTaskQueues(" ")).toThrow();
    expect(() => agentTaskQueues("x".repeat(221))).toThrow();
  });
});
