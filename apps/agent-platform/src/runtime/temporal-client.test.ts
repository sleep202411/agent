import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const describeNamespace = vi.fn(async () => ({}));
const ensureConnected = vi.fn(async () => undefined);
const close = vi.fn(async () => undefined);
const connect = vi.fn(async () => ({
  workflowService: { describeNamespace },
  ensureConnected,
  close,
}));

vi.mock("@temporalio/client", () => ({
  Client: class {
    constructor(readonly options: unknown) {}
  },
  Connection: { connect },
  WithStartWorkflowOperation: class {},
  WorkflowIdConflictPolicy: {},
  WorkflowIdReusePolicy: {},
}));

vi.mock("@temporalio/envconfig", () => ({
  loadClientConnectConfig: () => ({
    connectionOptions: { address: "temporal.test:7233" },
    namespace: "fizzdragon",
  }),
}));

const { assertTemporalReady, closeTemporalClient } = await import("./temporal-client.js");

const config = {
  temporal: { address: "temporal.test:7233", namespace: "fizzdragon" },
} as never;

beforeEach(() => {
  describeNamespace.mockClear();
  ensureConnected.mockClear();
  connect.mockClear();
});

afterEach(async () => {
  await closeTemporalClient();
});

describe("assertTemporalReady", () => {
  it("round-trips to the frontend on the configured namespace", async () => {
    await assertTemporalReady(config);

    expect(describeNamespace).toHaveBeenCalledWith({ namespace: "fizzdragon" });
  });

  // The regression this guards: the client is memoised and Connection.connect()
  // has already established the channel, so ensureConnected() alone performs no
  // network IO after the first call. A probe that only calls it keeps reporting
  // ready on a replica that has lost Temporal, and Kubernetes never removes it.
  it("performs network IO on every probe, not only the first", async () => {
    await assertTemporalReady(config);
    await assertTemporalReady(config);
    await assertTemporalReady(config);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(describeNamespace).toHaveBeenCalledTimes(3);
  });

  it("fails the probe when the frontend rejects, so the replica is removed", async () => {
    describeNamespace.mockRejectedValueOnce(new Error("UNAVAILABLE"));

    await expect(assertTemporalReady(config)).rejects.toThrow("UNAVAILABLE");
  });
});
