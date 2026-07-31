import {
  ActivityCancellationType,
  ApplicationFailure,
  isCancellation,
  proxyActivities,
} from "@temporalio/workflow";

import {
  longDocumentWorkflowInputSchema,
  type LongDocumentArtifactRef,
  type LongDocumentCompleteActivityInput,
  type LongDocumentFailActivityInput,
  type LongDocumentFinalizeActivityInput,
  type LongDocumentManifest,
  type LongDocumentMapActivityInput,
  type LongDocumentReduceActivityInput,
  type LongDocumentWorkflowInput,
} from "./long-document-contracts.js";
import { findInternalErrorCode, retryabilityFrom } from "./public-error.js";

const REDUCE_FAN_IN = 8;

type LongDocumentActivities = Readonly<{
  claimLongDocumentAnalysisActivity(
    input: LongDocumentWorkflowInput
  ): Promise<LongDocumentManifest>;
  mapLongDocumentSectionActivity(
    input: LongDocumentMapActivityInput
  ): Promise<LongDocumentArtifactRef>;
  reduceLongDocumentAnalysisActivity(
    input: LongDocumentReduceActivityInput
  ): Promise<LongDocumentArtifactRef>;
  finalizeLongDocumentAnalysisActivity(
    input: LongDocumentFinalizeActivityInput
  ): Promise<LongDocumentArtifactRef>;
  completeLongDocumentAnalysisActivity(
    input: LongDocumentCompleteActivityInput
  ): Promise<LongDocumentArtifactRef>;
  failLongDocumentAnalysisActivity(input: LongDocumentFailActivityInput): Promise<void>;
}>;

const activityClient = proxyActivities<LongDocumentActivities>({
  startToCloseTimeout: "25 minutes",
  scheduleToCloseTimeout: "2 hours",
  heartbeatTimeout: "5 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "1 minute",
    maximumAttempts: 4,
  },
});

/**
 * The terminal failure report is the only transition that moves the product job
 * row out of its active status, and no dispatcher sweep reclaims an active row.
 * It therefore gets its own budget: small idempotent write, retried until the
 * schedule-to-close bound rather than after four attempts.
 */
const terminalReportClient = proxyActivities<
  Pick<LongDocumentActivities, "failLongDocumentAnalysisActivity">
>({
  startToCloseTimeout: "1 minute",
  scheduleToCloseTimeout: "30 minutes",
  heartbeatTimeout: "5 seconds",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
  },
});

/**
 * Exhaustive, resumable map/tree-reduce analysis.
 *
 * Workflow history contains only immutable identities and bounded artifact
 * references. Raw source text and model checkpoint bodies never cross the
 * Activity boundary into Temporal history.
 */
export async function agentLongDocumentAnalysisWorkflow(
  rawInput: LongDocumentWorkflowInput
): Promise<LongDocumentArtifactRef> {
  const input = longDocumentWorkflowInputSchema.parse(rawInput);
  try {
    const manifest = await activityClient.claimLongDocumentAnalysisActivity(input);
    const mapped = await mapAllSections(manifest);
    const root = await reduceToRoot(input.jobId, manifest, mapped);
    const finalLevel = Math.max(1, root.level + 1);
    const completedFinal = findCompletedArtifact(manifest, "final", finalLevel, 0);
    const finalArtifact =
      completedFinal ??
      (await activityClient.finalizeLongDocumentAnalysisActivity({
        schemaVersion: "agent-long-document-finalize-activity/v1",
        jobId: input.jobId,
        level: finalLevel,
        inputArtifactId: root.artifactId,
        chunkCount: manifest.document.chunkCount,
      }));
    return activityClient.completeLongDocumentAnalysisActivity({
      schemaVersion: "agent-long-document-complete-activity/v1",
      jobId: input.jobId,
      finalArtifactId: finalArtifact.artifactId,
    });
  } catch (error) {
    if (!isCancellation(error)) {
      await reportTerminalFailure(input.jobId, error);
    }
    throw error;
  }
}

/**
 * Every uncheckpointed section is dispatched at once, bounded only by the
 * documented 256-section index.
 *
 * Batching here would not add safety — the Worker's document lane already caps
 * how many section Activities execute at a time — but it does cost throughput:
 * a barrier every N sections drains the lane to zero and pays the slowest
 * section of each batch, including its Activity retries, before the next
 * section can even be scheduled.
 */
function mapAllSections(manifest: LongDocumentManifest): Promise<LongDocumentArtifactRef[]> {
  return Promise.all(
    manifest.sections.map((section) => {
      const existing = findCompletedArtifact(manifest, "section", 0, section.ordinal);
      return (
        existing ??
        activityClient.mapLongDocumentSectionActivity({
          schemaVersion: "agent-long-document-map-activity/v1",
          jobId: manifest.jobId,
          chunkId: section.chunkId,
          ordinal: section.ordinal,
        })
      );
    })
  );
}

async function reduceToRoot(
  jobId: string,
  manifest: LongDocumentManifest,
  mapped: LongDocumentArtifactRef[]
): Promise<LongDocumentArtifactRef> {
  let current = mapped;
  let level = 1;
  while (current.length > 1) {
    const groups: LongDocumentArtifactRef[][] = [];
    for (let offset = 0; offset < current.length; offset += REDUCE_FAN_IN) {
      groups.push(current.slice(offset, offset + REDUCE_FAN_IN));
    }
    // Siblings in a level read disjoint checkpoints and only the next level
    // joins them, so running them one at a time serializes the most expensive
    // model calls in the plan for no ordering guarantee.
    current = await Promise.all(
      groups.map((inputs, ordinal) => {
        const existing = findCompletedArtifact(manifest, "reduce", level, ordinal);
        if (existing && sameLineage(existing, inputs)) return existing;
        return activityClient.reduceLongDocumentAnalysisActivity({
          schemaVersion: "agent-long-document-reduce-activity/v1",
          jobId,
          level,
          ordinal,
          inputArtifactIds: inputs.map((artifact) => artifact.artifactId),
        });
      })
    );
    level += 1;
  }
  const root = current[0];
  if (!root) {
    throw ApplicationFailure.nonRetryable(
      "The document analysis plan contained no source sections.",
      "AGENT_DOCUMENT_ANALYSIS_EMPTY"
    );
  }
  return root;
}

function findCompletedArtifact(
  manifest: LongDocumentManifest,
  kind: LongDocumentArtifactRef["kind"],
  level: number,
  ordinal: number
): LongDocumentArtifactRef | undefined {
  return manifest.completedArtifacts.find(
    (artifact) => artifact.kind === kind && artifact.level === level && artifact.ordinal === ordinal
  );
}

function sameLineage(
  artifact: LongDocumentArtifactRef,
  inputs: readonly LongDocumentArtifactRef[]
): boolean {
  const expected = [...new Set(inputs.flatMap((input) => input.sourceChunkIds))];
  return (
    artifact.sourceChunkIds.length === expected.length &&
    artifact.sourceChunkIds.every((chunkId, index) => chunkId === expected[index])
  );
}

async function reportTerminalFailure(jobId: string, error: unknown): Promise<void> {
  // Read the originating failure through the ActivityFailure wrapper.
  // ApplicationFailure.fromError() would instead describe the wrapper itself,
  // reporting every permanent analysis failure as a generic retryable one.
  try {
    await terminalReportClient.failLongDocumentAnalysisActivity({
      schemaVersion: "agent-long-document-fail-activity/v1",
      jobId,
      error: {
        code: publicFailureCode(findInternalErrorCode(error)),
        message:
          "FizzDragon could not complete the source document analysis. Please retry the analysis.",
        retryable: retryabilityFrom(error) ?? true,
      },
    });
  } catch {
    // Reporting exhausted its own retry budget. The original failure stays
    // workflow truth, but the product job row is left non-terminal: only a
    // dispatcher-side reclaim of stale active jobs can recover it.
  }
}

function publicFailureCode(value: string | null | undefined): string {
  return value && /^AGENT_DOCUMENT_[A-Z0-9_]{0,112}$/u.test(value)
    ? value
    : "AGENT_DOCUMENT_ANALYSIS_FAILED";
}
