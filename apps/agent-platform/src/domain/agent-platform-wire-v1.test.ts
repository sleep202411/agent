import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AgentDocumentFinalAnalysisSchema,
  AgentDocumentSectionAnalysisSchema,
  AgentInvocationLifecycleAcknowledgementSchema,
  AgentInvocationLifecycleRequestSchema,
  AgentLongDocumentArtifactsContextSchema,
  AgentLongDocumentManifestSchema,
  AgentLongDocumentSectionContextSchema,
} from "./agent-platform-wire-v1.js";

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../../packages/shared/test-fixtures/agent-platform-wire-v1.json",
      import.meta.url
    ),
    "utf8"
  )
) as {
  schemaVersions: string[];
  valid: Record<string, unknown>;
  invalid: Record<string, unknown>;
};

describe("Agent Platform v1 server boundary compatibility", () => {
  it("accepts every golden server payload without a private package dependency", () => {
    expect(fixture.schemaVersions).toEqual([
      "agent-invocation-lifecycle/v1",
      "agent-invocation-lifecycle-ack/v1",
      "agent-long-document-manifest/v1",
      "agent-long-document-section-context/v1",
      "agent-long-document-artifacts-context/v1",
      "agent-document-section-analysis/v1",
      "agent-document-synthesis/v1",
      "agent-document-final-analysis/v1",
    ]);

    expect(
      AgentInvocationLifecycleRequestSchema.parse(fixture.valid.lifecycleRunning)
    ).toBeTruthy();
    expect(AgentInvocationLifecycleRequestSchema.parse(fixture.valid.lifecycleFailed)).toBeTruthy();
    expect(
      AgentInvocationLifecycleAcknowledgementSchema.parse(fixture.valid.lifecycleAcknowledgement)
    ).toBeTruthy();
    expect(AgentLongDocumentManifestSchema.parse(fixture.valid.manifest)).toBeTruthy();
    expect(AgentLongDocumentSectionContextSchema.parse(fixture.valid.sectionContext)).toBeTruthy();
    expect(
      AgentLongDocumentArtifactsContextSchema.parse(fixture.valid.artifactsContext)
    ).toBeTruthy();
  });

  it("rejects golden semantic violations instead of weakening the boundary", () => {
    expect(
      AgentInvocationLifecycleRequestSchema.safeParse(fixture.invalid.succeededWithError).success
    ).toBe(false);
    expect(AgentLongDocumentManifestSchema.safeParse(fixture.invalid.manifestWithGap).success).toBe(
      false
    );
    expect(
      AgentDocumentSectionAnalysisSchema.safeParse(
        fixture.invalid.sectionAnalysisWithForeignEvidence
      ).success
    ).toBe(false);
    expect(
      AgentDocumentFinalAnalysisSchema.safeParse(fixture.invalid.finalAnalysisWithMissingCoverage)
        .success
    ).toBe(false);
  });
});
