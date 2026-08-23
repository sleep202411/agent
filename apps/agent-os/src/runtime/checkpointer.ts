import type { RunnableConfig } from "@langchain/core/runnables";
import { MemorySaver } from "@langchain/langgraph";
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import {
  AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED,
  agentOsCheckpointExecutionLockKey,
} from "@repo/shared";
import pg, { type PoolClient } from "pg";

const { Pool } = pg;
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export interface AgentOsCheckpointExecutionIdentity {
  kind: "start" | "continuation";
  runId: string;
  conversationId: string;
  executionToken: string;
  executionAttemptId: string;
  executionEpoch: number;
  executionOwnerId: string;
}

export interface AgentOsCheckpointExecutionLease {
  checkpointer: BaseCheckpointSaver;
  release(): Promise<void>;
}

/**
 * Expected control flow for a checkpoint writer whose durable execution epoch
 * is no longer authoritative. This is deliberately distinct from transport,
 * serialization, and database failures: the old graph must stop without
 * terminalizing the run or crashing the Worker, while every unexpected saver
 * failure continues to propagate.
 */
export class AgentOsCheckpointExecutionSupersededError extends Error {
  readonly code = "AGENT_OS_CHECKPOINT_EXECUTION_SUPERSEDED";

  constructor(message: string) {
    super(message);
    this.name = "AgentOsCheckpointExecutionSupersededError";
  }
}

interface ExecutionRow {
  status: string;
  startCommand: unknown | null;
  startExecutionFinishedAt: Date | null;
  startExecutionToken: string | null;
  startExecutionAttemptId: string | null;
  startExecutionEpoch: number;
  startExecutionOwnerId: string | null;
  continuationCommand: unknown | null;
  continuationExecutionFinishedAt: Date | null;
  continuationExecutionToken: string | null;
  continuationExecutionAttemptId: string | null;
  continuationExecutionEpoch: number;
  continuationExecutionOwnerId: string | null;
}

/**
 * PostgresSaver with a transactional execution fence around every write.
 *
 * LangGraph's stock saver owns its own short transaction, so an HTTP preflight
 * cannot prevent an expired Worker from committing after a newer epoch takes
 * over. This subclass keeps the upstream read/serialization implementation,
 * but writes the proof check and checkpoint rows in one PostgreSQL transaction.
 * The check also proves that checkpoints and `agent_os_runs` share one database;
 * a separately configured checkpoint database fails closed.
 */
export class AgentOsPostgresSaver extends PostgresSaver {
  private readonly authorityPool: pg.Pool;
  private readonly lockPool: pg.Pool;
  private readonly quotedSchema: string;

  constructor(pool: pg.Pool, lockPool: pg.Pool, schema: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid AGENT_OS_CHECKPOINT_SCHEMA: ${schema}`);
    }
    super(pool, undefined, { schema });
    this.authorityPool = pool;
    this.lockPool = lockPool;
    this.quotedSchema = `"${schema}"`;
  }

  async assertControlPlaneAuthority(): Promise<void> {
    const result = await this.authorityPool.query<{ relation: string | null }>(
      `SELECT to_regclass('public.agent_os_runs')::text AS relation`
    );
    if (!result.rows[0]?.relation) {
      throw new Error(
        "Agent OS checkpoints must share the PostgreSQL database that owns public.agent_os_runs"
      );
    }
  }

  async acquireExecution(
    identity: AgentOsCheckpointExecutionIdentity
  ): Promise<AgentOsCheckpointExecutionLease | null> {
    // Guard sessions live for an entire model/tool turn. They must never pin
    // the saver pool itself or N live executions would consume all N saver
    // connections and deadlock their own put()/putWrites() transactions.
    const client = await this.lockPool.connect();
    const lockKey = agentOsCheckpointExecutionLockKey(identity.conversationId);
    try {
      const result = await client.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended($1, $2::bigint)) AS acquired`,
        [lockKey, AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED]
      );
      if (result.rows[0]?.acquired !== true) {
        client.release();
        return null;
      }
      const guard = new PostgresExecutionGuard(client, lockKey);
      return {
        checkpointer: new ExecutionFencedSaver(this, identity, guard),
        release: () => guard.release(),
      };
    } catch (error) {
      client.release(error instanceof Error ? error : undefined);
      throw error;
    }
  }

  override async end(): Promise<void> {
    await Promise.all([super.end(), this.lockPool.end()]);
  }

  async putFenced(
    identity: AgentOsCheckpointExecutionIdentity,
    guard: ExecutionGuard,
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    await guard.assertHeld();
    const configurable = config.configurable;
    if (!configurable) throw new Error('Missing "configurable" field in checkpoint config');
    const threadId = String(configurable.thread_id ?? "");
    const checkpointNamespace = String(configurable.checkpoint_ns ?? "");
    const parentCheckpointId = configurable.checkpoint_id
      ? String(configurable.checkpoint_id)
      : null;
    assertCheckpointThread(identity, threadId, checkpointNamespace);
    const nextConfig: RunnableConfig = {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNamespace,
        checkpoint_id: checkpoint.id,
      },
    };
    const serializedCheckpoint = this._dumpCheckpoint(checkpoint);
    const [serializedBlobs, serializedMetadata] = await Promise.all([
      this._dumpBlobs(threadId, checkpointNamespace, checkpoint.channel_values, newVersions),
      this._dumpMetadata(metadata),
    ]);
    const client = await this.authorityPool.connect();
    try {
      await client.query("BEGIN");
      await assertCurrentExecutionInTransaction(client, identity);
      for (const blob of serializedBlobs) {
        await client.query(
          `INSERT INTO ${this.quotedSchema}.checkpoint_blobs
             (thread_id, checkpoint_ns, channel, version, type, blob)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (thread_id, checkpoint_ns, channel, version) DO NOTHING`,
          blob
        );
      }
      await client.query(
        `INSERT INTO ${this.quotedSchema}.checkpoints
           (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id)
         DO UPDATE SET checkpoint = EXCLUDED.checkpoint, metadata = EXCLUDED.metadata`,
        [
          threadId,
          checkpointNamespace,
          checkpoint.id,
          parentCheckpointId,
          serializedCheckpoint,
          serializedMetadata,
        ]
      );
      await client.query("COMMIT");
      return nextConfig;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async putWritesFenced(
    identity: AgentOsCheckpointExecutionIdentity,
    guard: ExecutionGuard,
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    await guard.assertHeld();
    const threadId = String(config.configurable?.thread_id ?? "");
    const checkpointNamespace = String(config.configurable?.checkpoint_ns ?? "");
    const checkpointId = String(config.configurable?.checkpoint_id ?? "");
    assertCheckpointThread(identity, threadId, checkpointNamespace);
    if (!checkpointId) throw new Error("Checkpoint writes require checkpoint_id");
    const dumpedWrites = await this._dumpWrites(
      threadId,
      checkpointNamespace,
      checkpointId,
      taskId,
      writes
    );
    const overwrite = writes.every(([channel]) => channel in WRITES_IDX_MAP);
    const client = await this.authorityPool.connect();
    try {
      await client.query("BEGIN");
      await assertCurrentExecutionInTransaction(client, identity);
      for (const write of dumpedWrites) {
        await client.query(
          `INSERT INTO ${this.quotedSchema}.checkpoint_writes
             (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
           ${
             overwrite
               ? "DO UPDATE SET channel = EXCLUDED.channel, type = EXCLUDED.type, blob = EXCLUDED.blob"
               : "DO NOTHING"
           }`,
          write
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface ExecutionGuard {
  assertHeld(): Promise<void>;
  release(): Promise<void>;
}

class PostgresExecutionGuard implements ExecutionGuard {
  private active = true;
  private released = false;
  private readonly onClientError = (error: Error): void => {
    this.active = false;
    this.releaseClient(error);
  };

  constructor(
    private readonly client: PoolClient,
    private readonly lockKey: string
  ) {
    client.once("error", this.onClientError);
  }

  async assertHeld(): Promise<void> {
    if (!this.active) {
      throw new AgentOsCheckpointExecutionSupersededError(
        "Agent OS checkpoint execution lock was lost"
      );
    }
    try {
      await this.client.query("SELECT 1");
    } catch (error) {
      this.active = false;
      this.releaseClient(error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async release(): Promise<void> {
    if (this.released) return;
    const shouldUnlock = this.active;
    this.active = false;
    let unlockError: Error | undefined;
    try {
      if (shouldUnlock) {
        await this.client.query(`SELECT pg_advisory_unlock(hashtextextended($1, $2::bigint))`, [
          this.lockKey,
          AGENT_OS_CHECKPOINT_EXECUTION_LOCK_SEED,
        ]);
      }
    } catch (error) {
      unlockError =
        error instanceof Error
          ? error
          : new Error(`Failed to release checkpoint lock: ${String(error)}`);
      throw error;
    } finally {
      // An unlock error leaves the session's advisory-lock state unknown. The
      // pg Pool must destroy that connection instead of returning a possibly
      // still-locked client to healthy circulation.
      this.releaseClient(unlockError);
    }
  }

  private releaseClient(error?: Error): void {
    if (this.released) return;
    this.released = true;
    this.client.off("error", this.onClientError);
    this.client.release(error);
  }
}

class MemoryExecutionGuard implements ExecutionGuard {
  private active = true;

  constructor(private readonly releaseLock: () => void) {}

  async assertHeld(): Promise<void> {
    if (!this.active) {
      throw new AgentOsCheckpointExecutionSupersededError(
        "Agent OS in-memory checkpoint execution lock was lost"
      );
    }
  }

  async release(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.releaseLock();
  }
}

class ExecutionFencedSaver extends BaseCheckpointSaver {
  constructor(
    private readonly delegate: BaseCheckpointSaver,
    private readonly identity: AgentOsCheckpointExecutionIdentity,
    private readonly guard: ExecutionGuard
  ) {
    super(delegate.serde);
  }

  getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    return this.delegate.getTuple(config);
  }

  list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    return this.delegate.list(config, options);
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    if (this.delegate instanceof AgentOsPostgresSaver) {
      return this.delegate.putFenced(
        this.identity,
        this.guard,
        config,
        checkpoint,
        metadata,
        newVersions
      );
    }
    await this.guard.assertHeld();
    return this.delegate.put(config, checkpoint, metadata, newVersions);
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    if (this.delegate instanceof AgentOsPostgresSaver) {
      return this.delegate.putWritesFenced(this.identity, this.guard, config, writes, taskId);
    }
    await this.guard.assertHeld();
    return this.delegate.putWrites(config, writes, taskId);
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.guard.assertHeld();
    if (threadId !== this.identity.conversationId) {
      throw new Error("Execution cannot delete a different checkpoint thread");
    }
    return this.delegate.deleteThread(threadId);
  }

  getNextVersion(current: number | undefined): number {
    return this.delegate.getNextVersion(current);
  }
}

async function assertCurrentExecutionInTransaction(
  client: PoolClient,
  identity: AgentOsCheckpointExecutionIdentity
): Promise<void> {
  const result = await client.query<ExecutionRow>(
    `SELECT
       "status",
       "start_command" AS "startCommand",
       "start_execution_finished_at" AS "startExecutionFinishedAt",
       "start_execution_token"::text AS "startExecutionToken",
       "start_execution_attempt_id"::text AS "startExecutionAttemptId",
       "start_execution_epoch" AS "startExecutionEpoch",
       "start_execution_owner_id"::text AS "startExecutionOwnerId",
       "continuation_command" AS "continuationCommand",
       "continuation_execution_finished_at" AS "continuationExecutionFinishedAt",
       "continuation_execution_token"::text AS "continuationExecutionToken",
       "continuation_execution_attempt_id"::text AS "continuationExecutionAttemptId",
       "continuation_execution_epoch" AS "continuationExecutionEpoch",
       "continuation_execution_owner_id"::text AS "continuationExecutionOwnerId"
     FROM public.agent_os_runs
     WHERE "id" = $1::uuid AND "conversation_id" = $2::uuid
     FOR SHARE`,
    [identity.runId, identity.conversationId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Agent OS checkpoint execution references a missing durable run");
  if (TERMINAL_RUN_STATUSES.has(row.status)) {
    throw new AgentOsCheckpointExecutionSupersededError(
      `Terminal Agent OS run ${row.status} cannot write checkpoints`
    );
  }
  const current =
    identity.kind === "start"
      ? {
          command: row.startCommand,
          finishedAt: row.startExecutionFinishedAt,
          token: row.startExecutionToken,
          attemptId: row.startExecutionAttemptId,
          epoch: row.startExecutionEpoch,
          ownerId: row.startExecutionOwnerId,
        }
      : {
          command: row.continuationCommand,
          finishedAt: row.continuationExecutionFinishedAt,
          token: row.continuationExecutionToken,
          attemptId: row.continuationExecutionAttemptId,
          epoch: row.continuationExecutionEpoch,
          ownerId: row.continuationExecutionOwnerId,
        };
  if (
    !current.command ||
    current.finishedAt ||
    current.token !== identity.executionToken ||
    current.attemptId !== identity.executionAttemptId ||
    current.epoch !== identity.executionEpoch ||
    current.ownerId !== identity.executionOwnerId
  ) {
    throw new AgentOsCheckpointExecutionSupersededError(
      `Agent OS ${identity.kind} checkpoint writer was superseded by another execution epoch`
    );
  }
}

function assertCheckpointThread(
  identity: AgentOsCheckpointExecutionIdentity,
  threadId: string,
  checkpointNamespace: string
): void {
  if (threadId !== identity.conversationId || checkpointNamespace !== "") {
    throw new Error(
      "Agent OS execution checkpoints must use the durable conversation thread and canonical namespace"
    );
  }
}

const inMemoryLocks = new WeakMap<BaseCheckpointSaver, Set<string>>();

export async function acquireAgentOsCheckpointExecution(
  checkpointer: BaseCheckpointSaver,
  identity: AgentOsCheckpointExecutionIdentity
): Promise<AgentOsCheckpointExecutionLease | null> {
  if (checkpointer instanceof AgentOsPostgresSaver) {
    return checkpointer.acquireExecution(identity);
  }
  const held = inMemoryLocks.get(checkpointer) ?? new Set<string>();
  inMemoryLocks.set(checkpointer, held);
  if (held.has(identity.conversationId)) return null;
  held.add(identity.conversationId);
  const guard = new MemoryExecutionGuard(() => held.delete(identity.conversationId));
  return {
    checkpointer: new ExecutionFencedSaver(checkpointer, identity, guard),
    release: () => guard.release(),
  };
}

let singleton: BaseCheckpointSaver | null = null;
let setupPromise: Promise<void> | null = null;

/**
 * Production PostgreSQL checkpoints must share the database that stores
 * `agent_os_runs`; otherwise execution/checkpoint atomicity is impossible and
 * startup fails closed. MemorySaver remains explicit unit/offline behavior.
 */
export async function getAgentOsCheckpointer(): Promise<BaseCheckpointSaver> {
  if (singleton) return singleton;

  const conn = process.env.AGENT_OS_CHECKPOINT_DATABASE_URL?.trim();

  if (!conn) {
    if (process.env.NODE_ENV === "test") {
      singleton = new MemorySaver();
      return singleton;
    }
    throw new Error(
      "AGENT_OS_CHECKPOINT_DATABASE_URL is required outside tests; Agent OS cannot run with ephemeral checkpoints"
    );
  }

  const schema = process.env.AGENT_OS_CHECKPOINT_SCHEMA?.trim() || "agent_os";
  const saverPoolMax = positivePoolSize(
    process.env.AGENT_OS_CHECKPOINT_POOL_MAX,
    10,
    "AGENT_OS_CHECKPOINT_POOL_MAX"
  );
  const lockPoolMax = positivePoolSize(
    process.env.AGENT_OS_CHECKPOINT_LOCK_POOL_MAX,
    20,
    "AGENT_OS_CHECKPOINT_LOCK_POOL_MAX"
  );
  const saver = new AgentOsPostgresSaver(
    new Pool({ connectionString: conn, max: saverPoolMax }),
    new Pool({ connectionString: conn, max: lockPoolMax }),
    schema
  );
  if (!setupPromise) {
    setupPromise = (async () => {
      await saver.setup();
      await saver.assertControlPlaneAuthority();
    })();
  }
  await setupPromise;
  singleton = saver;
  return singleton;
}

export function resetAgentOsCheckpointerForTests(): void {
  if (singleton instanceof AgentOsPostgresSaver) void singleton.end();
  singleton = null;
  setupPromise = null;
}

function positivePoolSize(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new Error(`${name} must be an integer between 1 and 1000`);
  }
  return value;
}
