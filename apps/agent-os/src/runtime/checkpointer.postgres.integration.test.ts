import { emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentOsPostgresSaver, type AgentOsCheckpointExecutionIdentity } from "./checkpointer.js";

const ENABLED = process.env.AGENT_OS_CHECKPOINT_POSTGRES_INTEGRATION === "1";
const describePostgres = ENABLED ? describe : describe.skip;
const DATABASE_URL =
  process.env.DATABASE_URL?.trim() || "postgres://fizzdragon:fizzdragon@localhost:5433/fizzdragon";
const { Pool } = pg;

describePostgres("Agent OS fenced Postgres checkpointer", () => {
  const runIds: string[] = [];
  const conversationIds: string[] = [];
  let authority: pg.Pool;

  beforeAll(async () => {
    assertLocalDatabase(DATABASE_URL);
    authority = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const result = await authority.query<{ relation: string | null }>(
      `SELECT to_regclass('public.agent_os_runs')::text AS relation`
    );
    if (!result.rows[0]?.relation) {
      throw new Error("Local PostgreSQL is missing Agent OS migrations");
    }
  });

  afterAll(async () => {
    if (!authority) return;
    for (const conversationId of conversationIds) {
      await authority.query(`DELETE FROM agent_os.checkpoint_writes WHERE thread_id = $1`, [
        conversationId,
      ]);
      await authority.query(`DELETE FROM agent_os.checkpoints WHERE thread_id = $1`, [
        conversationId,
      ]);
      await authority.query(`DELETE FROM agent_os.checkpoint_blobs WHERE thread_id = $1`, [
        conversationId,
      ]);
    }
    if (runIds.length > 0) {
      await authority.query(`DELETE FROM public.agent_os_runs WHERE id = ANY($1::uuid[])`, [
        runIds,
      ]);
    }
    await authority.end();
  });

  it("separates pinned guard sessions from a max=1 saver pool", async () => {
    const first = executionIdentity(1);
    const second = executionIdentity(2);
    runIds.push(first.runId, second.runId);
    conversationIds.push(first.conversationId, second.conversationId);
    await seedExecution(authority, first);
    await seedExecution(authority, second);

    const saverPool = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const guardPool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    const saver = new AgentOsPostgresSaver(saverPool, guardPool, "agent_os");
    await saver.setup();
    const leaseOne = await saver.acquireExecution(first);
    const leaseTwo = await saver.acquireExecution(second);
    expect(leaseOne).not.toBeNull();
    expect(leaseTwo).not.toBeNull();

    await Promise.all([
      leaseOne!.checkpointer.put(
        config(first.conversationId),
        checkpoint("10000000-0000-6000-8000-000000000001", "one"),
        metadata(),
        { messages: 1 }
      ),
      leaseTwo!.checkpointer.put(
        config(second.conversationId),
        checkpoint("10000000-0000-6000-8000-000000000002", "two"),
        metadata(),
        { messages: 1 }
      ),
    ]);

    expect((await saver.getTuple(config(first.conversationId)))?.checkpoint.id).toBe(
      "10000000-0000-6000-8000-000000000001"
    );
    expect((await saver.getTuple(config(second.conversationId)))?.checkpoint.id).toBe(
      "10000000-0000-6000-8000-000000000002"
    );
    await leaseOne!.release();
    await leaseTwo!.release();
    await saver.end();
  });

  it("blocks takeover while A holds the thread and rejects A after epoch B", async () => {
    const first = executionIdentity(3);
    const replacementGuardProbe = executionIdentity(4);
    runIds.push(first.runId, replacementGuardProbe.runId);
    conversationIds.push(first.conversationId, replacementGuardProbe.conversationId);
    await seedExecution(authority, first);
    await seedExecution(authority, replacementGuardProbe);

    const guardApplicationName = `agent-os-checkpoint-guard-${first.runId}`;
    const saverA = new AgentOsPostgresSaver(
      new Pool({ connectionString: DATABASE_URL, max: 1 }),
      new Pool({
        connectionString: DATABASE_URL,
        max: 1,
        application_name: guardApplicationName,
      }),
      "agent_os"
    );
    const saverB = new AgentOsPostgresSaver(
      new Pool({ connectionString: DATABASE_URL, max: 1 }),
      new Pool({ connectionString: DATABASE_URL, max: 1 }),
      "agent_os"
    );
    await Promise.all([saverA.setup(), saverB.setup()]);
    const leaseA = await saverA.acquireExecution(first);
    expect(leaseA).not.toBeNull();
    expect(await saverB.acquireExecution(first)).toBeNull();
    await leaseA!.checkpointer.put(
      config(first.conversationId),
      checkpoint("20000000-0000-6000-8000-000000000001", "epoch-a"),
      metadata(),
      { messages: 1 }
    );

    // A real guard-connection loss releases PostgreSQL's session lock. The
    // durable control plane can then grant B, while A's old saver view is
    // permanently unable to append checkpoints or pending writes.
    const terminated = await authority.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(pid) AS terminated
       FROM pg_stat_activity
       WHERE application_name = $1 AND pid <> pg_backend_pid()`,
      [guardApplicationName]
    );
    expect(terminated.rows).toContainEqual({ terminated: true });
    const second: AgentOsCheckpointExecutionIdentity = {
      ...first,
      executionAttemptId: "30000000-0000-4000-8000-000000000002",
      executionEpoch: 2,
      executionOwnerId: "30000000-0000-4000-8000-000000000003",
    };
    await authority.query(
      `UPDATE public.agent_os_runs
       SET start_execution_attempt_id = $2::uuid,
           start_execution_epoch = $3,
           start_execution_owner_id = $4::uuid
       WHERE id = $1::uuid`,
      [second.runId, second.executionAttemptId, second.executionEpoch, second.executionOwnerId]
    );
    const leaseB = await saverB.acquireExecution(second);
    expect(leaseB).not.toBeNull();
    await expect(
      leaseA!.checkpointer.put(
        config(first.conversationId),
        checkpoint("20000000-0000-6000-8000-000000000003", "late-a"),
        metadata(),
        { messages: 2 }
      )
    ).rejects.toThrow("checkpoint execution lock was lost");
    await expect(
      leaseA!.checkpointer.putWrites(
        {
          configurable: {
            thread_id: first.conversationId,
            checkpoint_ns: "",
            checkpoint_id: "20000000-0000-6000-8000-000000000001",
          },
        },
        [["messages", { role: "assistant", content: "late-a" }]],
        "late-a-task"
      )
    ).rejects.toThrow("checkpoint execution lock was lost");
    await leaseB!.checkpointer.put(
      config(second.conversationId),
      checkpoint("20000000-0000-6000-8000-000000000002", "epoch-b"),
      metadata(),
      { messages: 2 }
    );
    expect((await saverB.getTuple(config(second.conversationId)))?.checkpoint.id).toBe(
      "20000000-0000-6000-8000-000000000002"
    );
    expect(
      await authority.query(
        `SELECT 1 FROM agent_os.checkpoint_writes
         WHERE thread_id = $1 AND task_id = 'late-a-task'`,
        [first.conversationId]
      )
    ).toMatchObject({ rowCount: 0 });
    const replacementLease = await saverA.acquireExecution(replacementGuardProbe);
    expect(replacementLease).not.toBeNull();
    await replacementLease!.release();
    await leaseA!.release();
    await leaseB!.release();
    await Promise.all([saverA.end(), saverB.end()]);
  });
});

function executionIdentity(seed: number): AgentOsCheckpointExecutionIdentity {
  const suffix = seed.toString().padStart(12, "0");
  return {
    kind: "start",
    runId: `40000000-0000-4000-8000-${suffix}`,
    conversationId: `50000000-0000-4000-8000-${suffix}`,
    executionToken: `60000000-0000-4000-8000-${suffix}`,
    executionAttemptId: `70000000-0000-4000-8000-${suffix}`,
    executionEpoch: 1,
    executionOwnerId: `80000000-0000-4000-8000-${suffix}`,
  };
}

async function seedExecution(
  pool: pg.Pool,
  identity: AgentOsCheckpointExecutionIdentity
): Promise<void> {
  await pool.query(
    `INSERT INTO public.agent_os_runs (
       id, project_id, conversation_id, actor_id, model_profile_id, status,
       start_command, start_admission_version, client_submission_id,
       start_turn_id, start_user_message_id, submission_fingerprint,
       start_execution_token, start_execution_attempt_id,
       start_execution_epoch, start_execution_owner_id,
       start_execution_lease_expires_at, project_kind, workbench_mode
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, 'checkpoint-integration', 'running',
       '{}'::jsonb, 2, $5::uuid, $6::uuid, $7::uuid, $8,
       $9::uuid, $10::uuid, $11, $12::uuid,
       NOW() + INTERVAL '5 minutes', 'story', 'story-canvas'
     )`,
    [
      identity.runId,
      "90000000-0000-4000-8000-000000000001",
      identity.conversationId,
      `checkpoint-pg-${identity.runId}`,
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      "a".repeat(64),
      identity.executionToken,
      identity.executionAttemptId,
      identity.executionEpoch,
      identity.executionOwnerId,
    ]
  );
}

function config(threadId: string) {
  return { configurable: { thread_id: threadId, checkpoint_ns: "" } };
}

function checkpoint(id: string, text: string) {
  return {
    ...emptyCheckpoint(),
    id,
    channel_values: { messages: [{ role: "assistant", content: text }] },
    channel_versions: { messages: 1 },
  };
}

function metadata() {
  return { source: "loop" as const, step: 1, parents: {} };
}

function assertLocalDatabase(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    url.port !== "5433"
  ) {
    throw new Error(
      "Refusing checkpoint integration test: DATABASE_URL must target localhost:5433"
    );
  }
}
