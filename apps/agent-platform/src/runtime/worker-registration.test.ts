import { describe, expect, it } from "vitest";

import { agentActivityRegistrations, temporalWorkflowRegistration } from "./worker-registration.js";

describe("Agent Temporal Worker registration", () => {
  it("registers every long-document Activity on its isolated document lane", () => {
    expect(Object.keys(agentActivityRegistrations.document).sort()).toEqual([
      "claimLongDocumentAnalysisActivity",
      "completeLongDocumentAnalysisActivity",
      "failLongDocumentAnalysisActivity",
      "finalizeLongDocumentAnalysisActivity",
      "mapLongDocumentSectionActivity",
      "reduceLongDocumentAnalysisActivity",
    ]);
    expect(
      Object.values(agentActivityRegistrations.document).every(
        (activity) => typeof activity === "function"
      )
    ).toBe(true);
  });

  it("keeps control, inference, tool, lifecycle and cleanup Activities isolated", () => {
    expect(
      Object.fromEntries(
        Object.entries(agentActivityRegistrations)
          .filter(([lane]) => lane !== "document")
          .map(([lane, activities]) => [lane, Object.keys(activities)])
      )
    ).toEqual({
      control: ["openRunActivity"],
      inference: ["runInferenceActivity"],
      tool: ["executeToolActivity"],
      lifecycle: ["reportInvocationLifecycleActivity"],
      cleanup: ["endRunActivity"],
    });
  });

  it("requires the prebuilt Workflow bundle in production", () => {
    expect(
      temporalWorkflowRegistration({
        nodeEnv: "production",
        cwd: "/opt/fizzdragon-agent",
        fileExists: () => true,
      })
    ).toEqual({
      workflowBundle: {
        codePath: "/opt/fizzdragon-agent/.temporal/workflow-bundle.js",
      },
    });
    expect(() =>
      temporalWorkflowRegistration({
        nodeEnv: "production",
        cwd: "/opt/fizzdragon-agent",
        fileExists: () => false,
      })
    ).toThrow("Prebuilt Temporal workflow bundle is missing");
  });
});
