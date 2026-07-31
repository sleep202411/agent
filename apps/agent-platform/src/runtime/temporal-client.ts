import { randomUUID } from "node:crypto";

import {
  Client,
  Connection,
  WithStartWorkflowOperation,
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/common";
import { loadClientConnectConfig } from "@temporalio/envconfig";

import type { RuntimeConfig } from "../config/env.js";
import {
  CANCEL_AGENT_INVOCATION_UPDATE,
  ENQUEUE_AGENT_INVOCATION_UPDATE,
  agentCancellationResultSchema,
  agentInvocationAdmissionSchema,
  type AgentCancellationCommand,
  type AgentCancellationResult,
  type AgentInvocationCommand,
} from "./contracts.js";
import { sessionWorkflowIdentity } from "./invocation-identity.js";

let cached:
  | Readonly<{
      connection: Connection;
      client: Client;
    }>
  | undefined;
let connecting:
  | Promise<
      Readonly<{
        connection: Connection;
        client: Client;
      }>
    >
  | undefined;

export async function enqueueAgentInvocation(
  config: RuntimeConfig,
  input: AgentInvocationCommand
): Promise<string> {
  const { client } = await getTemporalClient(config);
  const workflowId = sessionWorkflowIdentity(input.invocation.sessionName);
  const startWorkflowOperation = new WithStartWorkflowOperation("fizzDragonAgentSessionWorkflow", {
    taskQueue: config.temporal.taskQueue,
    workflowId,
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    workflowTaskTimeout: "10 seconds",
    args: [
      {
        schemaVersion: "agent-session-workflow/v2",
        sessionName: input.invocation.sessionName,
        pendingInvocations: [],
        cancelledPendingInvocationIds: [],
        recentAttempts: [],
        aggregateAttempts: [],
      },
    ],
    memo: {
      schemaVersion: "agent-session-workflow/v2",
      surface: input.context.surface,
    },
  });
  const admission = agentInvocationAdmissionSchema.parse(
    await client.workflow.executeUpdateWithStart(ENQUEUE_AGENT_INVOCATION_UPDATE, {
      args: [input],
      // A queue-full result completes the Temporal Update. Reusing the
      // invocation ID as the Update ID would replay that rejection forever,
      // even after capacity returns. Invocation-level idempotency lives in
      // the Workflow's acceptedIds state, including ambiguous HTTP retries.
      updateId: randomUUID(),
      startWorkflowOperation,
    })
  );
  if (admission.invocationId !== input.invocationId) {
    throw new Error("Temporal admitted a different Agent invocation identity");
  }
  if (admission.attemptId !== input.attemptId) {
    throw new Error("Temporal admitted a different Agent attempt identity");
  }
  if (admission.attemptOrdinal !== input.attemptOrdinal) {
    throw new Error("Temporal admitted a different Agent attempt ordinal");
  }
  if (admission.status === "queue-full") {
    throw new AgentInvocationQueueFullError(input.invocation.sessionName);
  }
  if (admission.status === "sequence-conflict") {
    throw new AgentInvocationSequenceConflictError(input);
  }
  return workflowId;
}

export class AgentInvocationQueueFullError extends Error {
  readonly code = "AGENT_SESSION_QUEUE_FULL";

  constructor(sessionName: string) {
    super(`The bounded Agent invocation queue is full for session ${sessionName}.`);
    this.name = "AgentInvocationQueueFullError";
  }
}

export class AgentInvocationSequenceConflictError extends Error {
  readonly code = "AGENT_ATTEMPT_SEQUENCE_CONFLICT";

  constructor(
    input: Pick<AgentInvocationCommand, "invocationId" | "attemptId" | "attemptOrdinal">
  ) {
    super(
      `Attempt ${input.attemptId} is not the next valid durable attempt for invocation ${input.invocationId}.`
    );
    this.name = "AgentInvocationSequenceConflictError";
  }
}

export async function cancelAgentInvocation(
  config: RuntimeConfig,
  input: AgentCancellationCommand
): Promise<AgentCancellationResult> {
  const { client } = await getTemporalClient(config);
  const workflowId = sessionWorkflowIdentity(input.sessionName);
  try {
    const result = await client.workflow
      .getHandle(workflowId)
      .executeUpdate(CANCEL_AGENT_INVOCATION_UPDATE, {
        args: [input],
      });
    return agentCancellationResultSchema.parse(result);
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      return {
        schemaVersion: "agent-cancellation-result/v1",
        invocationId: input.invocationId,
        status: "not-active",
      };
    }
    throw error;
  }
}

/**
 * Readiness must perform real network IO on every call. `ensureConnected()`
 * cannot: `Connection.connect()` already established the channel and the
 * client is memoised, so after the first success it returns without touching
 * the wire and a replica that has lost Temporal keeps reporting ready.
 * `describeNamespace` round-trips to the frontend and additionally proves the
 * configured namespace is still reachable by this identity.
 */
export async function assertTemporalReady(config: RuntimeConfig): Promise<void> {
  const { connection } = await getTemporalClient(config);
  await connection.ensureConnected();
  await connection.workflowService.describeNamespace({
    namespace: config.temporal.namespace,
  });
}

export async function closeTemporalClient(): Promise<void> {
  const current = cached;
  cached = undefined;
  connecting = undefined;
  await current?.connection.close();
}

async function getTemporalClient(config: RuntimeConfig): Promise<
  Readonly<{
    connection: Connection;
    client: Client;
  }>
> {
  if (cached) return cached;
  connecting ??= connect(config);
  try {
    cached = await connecting;
    return cached;
  } finally {
    connecting = undefined;
  }
}

async function connect(config: RuntimeConfig) {
  const fromEnvironment = loadClientConnectConfig({ disableFile: true });
  if (fromEnvironment.connectionOptions.address !== config.temporal.address) {
    throw new Error("Temporal address configuration is inconsistent");
  }
  if (fromEnvironment.namespace && fromEnvironment.namespace !== config.temporal.namespace) {
    throw new Error("Temporal namespace configuration is inconsistent");
  }
  const connection = await Connection.connect(fromEnvironment.connectionOptions);
  return Object.freeze({
    connection,
    client: new Client({
      connection,
      namespace: config.temporal.namespace,
    }),
  });
}
