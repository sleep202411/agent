import type { WorkerStatus } from "@temporalio/worker";
import { describe, expect, it } from "vitest";
import { evaluateRuntimeWorkerHealth } from "./health-server.js";

describe("runtime worker health", () => {
  it("becomes ready only while the role-specific poller is running", () => {
    expect(
      evaluateRuntimeWorkerHealth(
        "control",
        workerStatus({
          runState: "INITIALIZED",
          workflowPollerState: "POLLING",
        }),
        false,
        false
      ).ready
    ).toBe(false);

    expect(
      evaluateRuntimeWorkerHealth(
        "control",
        workerStatus({
          runState: "RUNNING",
          workflowPollerState: "POLLING",
        }),
        false,
        false
      ).ready
    ).toBe(true);

    const draining = evaluateRuntimeWorkerHealth(
      "control",
      workerStatus({
        runState: "RUNNING",
        workflowPollerState: "POLLING",
      }),
      true,
      false
    );
    expect(draining.ready).toBe(false);
    expect(draining.alive).toBe(true);
  });

  it("uses the activity poller and fails liveness on a fatal worker state", () => {
    expect(
      evaluateRuntimeWorkerHealth(
        "activities",
        workerStatus({
          runState: "RUNNING",
          workflowPollerState: "FAILED",
          activityPollerState: "POLLING",
        }),
        false,
        false
      ).ready
    ).toBe(true);

    const failed = evaluateRuntimeWorkerHealth(
      "activities",
      workerStatus({
        runState: "FAILED",
        activityPollerState: "FAILED",
      }),
      false,
      false
    );
    expect(failed.alive).toBe(false);
    expect(failed.ready).toBe(false);
  });

  it("fails readiness while the process runs stale code, and says why", () => {
    const stale = evaluateRuntimeWorkerHealth(
      "control",
      workerStatus({ runState: "RUNNING", workflowPollerState: "POLLING" }),
      false,
      false,
      {
        stale: true,
        reasons: ["[artifact-drift] @repo/shared was rebuilt after this process loaded it"],
      }
    );

    expect(stale.ready).toBe(false);
    expect(stale.alive).toBe(true);
    expect(stale.codeStale).toBe(true);
    expect(stale.staleReasons).toEqual([
      "[artifact-drift] @repo/shared was rebuilt after this process loaded it",
    ]);
  });

  it("stays ready when the loaded code matches the sources", () => {
    const fresh = evaluateRuntimeWorkerHealth(
      "control",
      workerStatus({ runState: "RUNNING", workflowPollerState: "POLLING" }),
      false,
      false,
      { stale: false, reasons: [] }
    );

    expect(fresh.ready).toBe(true);
    expect(fresh.codeStale).toBe(false);
  });
});

function workerStatus(overrides: Partial<WorkerStatus>): WorkerStatus {
  return {
    runState: "RUNNING",
    workflowPollerState: "POLLING",
    activityPollerState: "POLLING",
    hasOutstandingWorkflowPoll: true,
    hasOutstandingActivityPoll: true,
    numCachedWorkflows: 0,
    numInFlightWorkflowActivations: 0,
    numInFlightActivities: 0,
    numInFlightNonLocalActivities: 0,
    numInFlightLocalActivities: 0,
    numHeartbeatingActivities: 0,
    ...overrides,
  };
}
