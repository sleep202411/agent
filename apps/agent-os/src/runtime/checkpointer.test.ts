import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { AgentOsPostgresSaver, type AgentOsCheckpointExecutionIdentity } from "./checkpointer.js";

describe("Agent OS checkpoint execution guard", () => {
  it("evicts a session whose advisory unlock failed instead of returning it healthy", async () => {
    const unlockError = new Error("checkpoint guard connection failed during unlock");
    const release = vi.fn();
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockRejectedValueOnce(unlockError),
      once: vi.fn(),
      off: vi.fn(),
      release,
    } as unknown as PoolClient;
    const lockPool = {
      connect: vi.fn(async () => client),
    } as unknown as Pool;
    const saverPool = {} as Pool;
    const saver = new AgentOsPostgresSaver(saverPool, lockPool, "agent_os");

    const lease = await saver.acquireExecution(executionIdentity());
    expect(lease).not.toBeNull();
    await expect(lease!.release()).rejects.toBe(unlockError);

    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(unlockError);
    expect(client.off).toHaveBeenCalledWith("error", expect.any(Function));
    await expect(lease!.release()).resolves.toBeUndefined();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

function executionIdentity(): AgentOsCheckpointExecutionIdentity {
  return {
    kind: "start",
    runId: "11111111-1111-4111-8111-111111111111",
    conversationId: "22222222-2222-4222-8222-222222222222",
    executionToken: "33333333-3333-4333-8333-333333333333",
    executionAttemptId: "44444444-4444-4444-8444-444444444444",
    executionEpoch: 1,
    executionOwnerId: "55555555-5555-4555-8555-555555555555",
  };
}
