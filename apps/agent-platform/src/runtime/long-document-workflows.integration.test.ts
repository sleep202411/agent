import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { ApplicationFailure, Context } from "@temporalio/activity";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { LongDocumentArtifactRef, LongDocumentManifest } from "./long-document-contracts.js";

let environment: TestWorkflowEnvironment;

beforeAll(async () => {
  environment = await TestWorkflowEnvironment.createLocal({
    server: {
      executable: process.env.TEMPORAL_CLI_PATH
        ? {
            type: "existing-path",
            path: process.env.TEMPORAL_CLI_PATH,
          }
        : { type: "cached-download", version: "default" },
      ui: false,
    },
  });
});

afterAll(async () => {
  await environment?.teardown();
});

describe("agentLongDocumentAnalysisWorkflow", () => {
  it("maps every section, performs a bounded eight-way tree reduce, and finalizes once", async () => {
    const harness = await createHarness(manifest(17));

    const result = await harness.run();

    expect(result).toEqual(harness.finalRef());
    expect(harness.activities.claim).toHaveBeenCalledTimes(1);
    expect(harness.activities.map).toHaveBeenCalledTimes(17);
    expect(harness.activities.reduce).toHaveBeenCalledTimes(4);
    // Siblings within a level run concurrently, so their arrival order is a
    // worker scheduling detail. What must hold is the plan: every group of a
    // level exactly once, and the next level only after the level below it.
    const reducePlan = harness.activities.reduce.mock.calls.map(
      ([input]) => input as { level: number; ordinal: number; inputArtifactIds: string[] }
    );
    expect(reducePlan.map((group) => group.level)).toEqual([1, 1, 1, 2]);
    expect(
      reducePlan
        .slice(0, 3)
        .map((group) => group.ordinal)
        .sort()
    ).toEqual([0, 1, 2]);
    expect(reducePlan[3]?.ordinal).toBe(0);
    expect(
      harness.activities.reduce.mock.calls.every(
        ([input]) => (input as { inputArtifactIds: string[] }).inputArtifactIds.length <= 8
      )
    ).toBe(true);
    expect(harness.activities.finalize).toHaveBeenCalledWith(
      expect.objectContaining({ level: 3, chunkCount: 17 })
    );
    expect(harness.activities.complete).toHaveBeenCalledTimes(1);
    expect(harness.activities.fail).not.toHaveBeenCalled();
  });

  it("dispatches every uncheckpointed section at once instead of draining a batch at a time", async () => {
    // Each section holds until all of them are in flight together. A workflow
    // that dispatches sections in batches never gets there: the lane it is
    // supposed to keep full drains to zero at every batch boundary, and the
    // whole document pays the slowest section of each batch in sequence.
    const gate = concurrencyGate(17);
    const harness = await createHarness(manifest(17), {
      activityConcurrency: 24,
      beforeMap: () => gate.arrive(),
    });

    await harness.run();

    expect(gate.released).toBe(true);
    expect(gate.peak).toBe(17);
  });

  it("runs the sibling reductions of a level concurrently", async () => {
    // Level-1 groups read disjoint checkpoints; only level 2 joins them.
    const gate = concurrencyGate(3);
    const harness = await createHarness(manifest(17), {
      activityConcurrency: 24,
      beforeReduce: () => gate.arrive(),
    });

    await harness.run();

    expect(gate.released).toBe(true);
    expect(gate.peak).toBe(3);
  });

  it("resumes from immutable map and reduce checkpoints without replaying completed model work", async () => {
    const base = manifest(10);
    const completedSections = base.sections
      .slice(0, 2)
      .map((section) => artifact("section", 0, section.ordinal, [section.chunkId]));
    const completedReduce = artifact(
      "reduce",
      1,
      0,
      base.sections.slice(0, 8).map((section) => section.chunkId)
    );
    const harness = await createHarness({
      ...base,
      completedArtifacts: [...completedSections, completedReduce],
    });

    await harness.run();

    expect(harness.activities.map).toHaveBeenCalledTimes(8);
    // Map Activities are dispatched concurrently, so arrival order is a worker
    // scheduling detail. What must hold is the set: every uncheckpointed
    // section, and only those.
    expect(
      harness.activities.map.mock.calls
        .map(([input]) => (input as { ordinal: number }).ordinal)
        .sort((left, right) => left - right)
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(harness.activities.reduce).toHaveBeenCalledTimes(2);
    expect(harness.activities.reduce).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ level: 1, ordinal: 1 })
    );
    expect(harness.activities.reduce).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ level: 2, ordinal: 0 })
    );
  });

  it("persists only a stable public terminal failure when analysis cannot proceed", async () => {
    const source = manifest(1);
    const harness = await createHarness(source, {
      claimError: ApplicationFailure.nonRetryable(
        "private provider response and source text",
        "AGENT_DOCUMENT_ANALYSIS_INDEX_INVALID"
      ),
    });

    await expect(harness.run()).rejects.toThrow();
    expect(harness.activities.fail).toHaveBeenCalledWith({
      schemaVersion: "agent-long-document-fail-activity/v1",
      jobId: source.jobId,
      error: {
        code: "AGENT_DOCUMENT_ANALYSIS_INDEX_INVALID",
        message:
          "FizzDragon could not complete the source document analysis. Please retry the analysis.",
        retryable: false,
      },
    });
    expect(JSON.stringify(harness.activities.fail.mock.calls)).not.toContain(
      "private provider response"
    );
  });

  it("keeps reporting the terminal failure past the shared Activity retry budget", async () => {
    const source = manifest(1);
    const harness = await createHarness(source, {
      claimError: ApplicationFailure.nonRetryable(
        "source index unreadable",
        "AGENT_DOCUMENT_ANALYSIS_INDEX_INVALID"
      ),
      failReportRejections: 4,
    });

    await expect(harness.run()).rejects.toThrow();

    // Nothing reclaims a job row the claim Activity already made active, so the
    // report must outlive a product gateway outage longer than four attempts.
    expect(harness.activities.fail).toHaveBeenCalledTimes(5);
    expect(harness.activities.fail).toHaveBeenLastCalledWith(
      expect.objectContaining({
        jobId: source.jobId,
        error: expect.objectContaining({ code: "AGENT_DOCUMENT_ANALYSIS_INDEX_INVALID" }),
      })
    );
  }, 45_000);
});

/**
 * Releases only once `size` Activities are waiting on it at the same time.
 *
 * The timeout releases everyone instead of hanging, so a workflow that never
 * reaches the required concurrency fails on the assertion rather than on the
 * suite timeout. Waiting Activities heartbeat because the document proxy holds
 * them to a five second heartbeat budget.
 */
function concurrencyGate(size: number, timeoutMs = 10_000) {
  let waiting = 0;
  let release = () => {};
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  const timer = setTimeout(() => release(), timeoutMs);
  timer.unref();
  const gate = {
    peak: 0,
    released: false,
    async arrive(): Promise<void> {
      waiting += 1;
      gate.peak = Math.max(gate.peak, waiting);
      if (waiting >= size) {
        gate.released = true;
        clearTimeout(timer);
        release();
      }
      const heartbeat = setInterval(() => Context.current().heartbeat(), 500);
      heartbeat.unref();
      try {
        await open;
      } finally {
        clearInterval(heartbeat);
        waiting -= 1;
      }
    },
  };
  return gate;
}

async function createHarness(
  source: LongDocumentManifest,
  options: Readonly<{
    claimError?: Error;
    failReportRejections?: number;
    activityConcurrency?: number;
    beforeMap?: () => Promise<void>;
    beforeReduce?: () => Promise<void>;
  }> = {}
) {
  const taskQueue = `agent-document-test-${randomUUID()}`;
  const byId = new Map(
    source.completedArtifacts.map((checkpoint) => [checkpoint.artifactId, checkpoint])
  );
  let final: LongDocumentArtifactRef | undefined;
  const claim = options.claimError
    ? vi.fn().mockRejectedValue(options.claimError)
    : vi.fn().mockResolvedValue(source);
  const map = vi.fn().mockImplementation(async (input: { ordinal: number; chunkId: string }) => {
    await options.beforeMap?.();
    const checkpoint = artifact("section", 0, input.ordinal, [input.chunkId]);
    byId.set(checkpoint.artifactId, checkpoint);
    return checkpoint;
  });
  const reduce = vi
    .fn()
    .mockImplementation(
      async (input: { level: number; ordinal: number; inputArtifactIds: string[] }) => {
        await options.beforeReduce?.();
        const checkpoint = artifact(
          "reduce",
          input.level,
          input.ordinal,
          input.inputArtifactIds.flatMap((id) => {
            const existing = byId.get(id);
            if (!existing) throw new Error(`Missing test checkpoint ${id}`);
            return existing.sourceChunkIds;
          })
        );
        byId.set(checkpoint.artifactId, checkpoint);
        return checkpoint;
      }
    );
  const finalize = vi
    .fn()
    .mockImplementation((input: { level: number; inputArtifactId: string }) => {
      const root = byId.get(input.inputArtifactId);
      if (!root) throw new Error("Missing test root checkpoint");
      final = artifact("final", input.level, 0, [...root.sourceChunkIds]);
      byId.set(final.artifactId, final);
      return final;
    });
  const complete = vi.fn().mockImplementation((input: { finalArtifactId: string }) => {
    const checkpoint = byId.get(input.finalArtifactId);
    if (!checkpoint) throw new Error("Missing test final checkpoint");
    return checkpoint;
  });
  const fail = vi.fn().mockImplementation(() => {
    if (fail.mock.calls.length <= (options.failReportRejections ?? 0)) {
      throw new Error("Product gateway is unavailable");
    }
    return undefined;
  });
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    namespace: environment.namespace,
    taskQueue,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities: {
      claimLongDocumentAnalysisActivity: claim,
      mapLongDocumentSectionActivity: map,
      reduceLongDocumentAnalysisActivity: reduce,
      finalizeLongDocumentAnalysisActivity: finalize,
      completeLongDocumentAnalysisActivity: complete,
      failLongDocumentAnalysisActivity: fail,
    },
    maxConcurrentWorkflowTaskExecutions: 2,
    maxConcurrentActivityTaskExecutions: options.activityConcurrency ?? 8,
    maxHeartbeatThrottleInterval: "100 milliseconds",
  });

  return {
    activities: { claim, map, reduce, finalize, complete, fail },
    finalRef: () => final,
    run: () =>
      worker.runUntil(() =>
        environment.client.workflow.execute("agentLongDocumentAnalysisWorkflow", {
          taskQueue,
          workflowId: `agent-document-analysis-${randomUUID()}`,
          args: [
            {
              schemaVersion: "agent-long-document-analysis-workflow/v1",
              jobId: source.jobId,
            },
          ],
        })
      ) as Promise<LongDocumentArtifactRef>,
  };
}

function manifest(chunkCount: number): LongDocumentManifest {
  const jobId = randomUUID();
  return {
    schemaVersion: "agent-long-document-manifest/v1",
    jobId,
    attachmentId: randomUUID(),
    locale: "en-US",
    sourceContentHash: "a".repeat(64),
    document: {
      title: "Complete feature screenplay",
      format: "screenplay",
      characterCount: 200_000,
      chunkCount,
    },
    sections: Array.from({ length: chunkCount }, (_, ordinal) => ({
      chunkId: `chunk-${String(ordinal).padStart(6, "0")}`,
      ordinal,
      heading: `Scene ${ordinal + 1}`,
      abstract: `Bounded scene ${ordinal + 1} abstract.`,
    })),
    completedArtifacts: [],
  };
}

function artifact(
  kind: LongDocumentArtifactRef["kind"],
  level: number,
  ordinal: number,
  sourceChunkIds: readonly string[]
): LongDocumentArtifactRef {
  return {
    artifactId: randomUUID(),
    kind,
    level,
    ordinal,
    sourceChunkIds: [...sourceChunkIds],
  };
}
