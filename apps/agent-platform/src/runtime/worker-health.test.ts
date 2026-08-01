import type { WorkerStatus } from "@temporalio/worker";
import { describe, expect, it } from "vitest";

import { workerGroupHealthSnapshot, workerHealthSnapshot } from "./worker-health.js";

function status(overrides: Partial<WorkerStatus> = {}): WorkerStatus {
  return {
    runState: "RUNNING",
    workflowPollerState: "POLLING",
    activityPollerState: "POLLING",
    hasOutstandingWorkflowPoll: true,
    hasOutstandingActivityPoll: true,
    numInFlightWorkflowActivations: 0,
    numInFlightActivities: 0,
    numInFlightNonLocalActivities: 0,
    numInFlightLocalActivities: 0,
    numCachedWorkflows: 0,
    numHeartbeatingActivities: 0,
    ...overrides,
  };
}

describe("workerHealthSnapshot", () => {
  it("is live and ready only while the Worker and both pollers are healthy", () => {
    expect(workerHealthSnapshot(status())).toMatchObject({
      live: true,
      ready: true,
      runState: "RUNNING",
    });
  });

  it("stays live but leaves service before shutdown drain begins", () => {
    expect(workerHealthSnapshot(status({ runState: "STOPPING" }))).toMatchObject({
      live: true,
      ready: false,
    });
  });

  it("reports a failed poller as not ready", () => {
    expect(workerHealthSnapshot(status({ workflowPollerState: "FAILED" }))).toMatchObject({
      live: true,
      ready: false,
    });
  });

  it("reports a failed or stopped Worker as not live", () => {
    expect(workerHealthSnapshot(status({ runState: "FAILED" }))).toMatchObject({
      live: false,
      ready: false,
    });
    expect(workerHealthSnapshot(status({ runState: "STOPPED" }))).toMatchObject({
      live: false,
      ready: false,
    });
  });

  it("requires every isolated execution lane to be live and ready", () => {
    const healthy = { getStatus: () => status() };
    const failed = {
      getStatus: () => status({ activityPollerState: "FAILED" }),
    };

    expect(
      workerGroupHealthSnapshot({
        workflow: healthy,
        inference: healthy,
        cleanup: healthy,
      })
    ).toMatchObject({ live: true, ready: true });
    expect(
      workerGroupHealthSnapshot({
        workflow: healthy,
        inference: failed,
        cleanup: healthy,
      })
    ).toMatchObject({ live: true, ready: false });
  });
});
