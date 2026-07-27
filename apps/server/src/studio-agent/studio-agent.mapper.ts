import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentActionSchema,
  StudioAgentApprovalSchema,
  StudioAgentErrorSchema,
  StudioAgentEventSchema,
  StudioAgentInputSchema,
  StudioAgentJsonObjectSchema,
  StudioAgentJsonValueSchema,
  StudioAgentMessagePartSchema,
  StudioAgentMessageSchema,
  StudioAgentPermissionPolicySchema,
  StudioAgentResourceRefSchema,
  StudioAgentRunSchema,
  StudioAgentTaskDescriptorSchema,
  StudioAgentThreadSchema,
  type StudioAgentAction,
  type StudioAgentApproval,
  type StudioAgentEvent,
  type StudioAgentInput,
  type StudioAgentMessage,
  type StudioAgentRun,
  type StudioAgentThread,
  type StudioAgentWorkflowInput,
} from '@repo/shared/studio-agent';
import {
  StudioAgentActivitySnapshotSchema,
  type StudioAgentActivitySnapshot,
} from '@repo/shared/studio-agent-api';

/**
 * These mappers are the corruption boundary between PostgreSQL and the public
 * wire contract. Persisted JSON is parsed every time it crosses the boundary:
 * an invalid row must fail loudly instead of leaking an almost-valid shape to
 * the runtime or browser.
 *
 * Structural row types keep this file independently testable and prevent
 * Prisma's generated JsonValue types from becoming part of the public domain
 * model.
 */

interface ThreadRow {
  id: string;
  workspaceId: string;
  surfaceId: string;
  scenarioId: string;
  scenarioVersion: string;
  scopeContainer: unknown;
  scopeFocus: unknown | null;
  ownerActorId: string;
  title: string | null;
  status: string;
  permissionPolicy: unknown;
  activeRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface MessageRow {
  id: string;
  clientMessageId: string | null;
  threadId: string;
  runId: string | null;
  ordinal: bigint | number;
  role: string;
  status: string;
  parts: unknown;
  createdAt: Date;
  completedAt: Date | null;
}

interface RunRow {
  id: string;
  threadId: string;
  rootRunId: string;
  parentRunId: string | null;
  kind: string;
  task: unknown | null;
  trigger: string;
  triggerMessageId: string | null;
  scenarioId: string;
  scenarioVersion: string;
  permissionPolicy: unknown;
  status: string;
  phase: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: unknown | null;
}

interface InputRow {
  id: string;
  threadId: string;
  targetRunId: string;
  messageId: string;
  delivery: string;
  status: string;
  sequence: bigint | number;
  promotedToRunId: string | null;
  acceptedAt: Date;
  consumedAt: Date | null;
}

interface ActionRow {
  id: string;
  threadId: string;
  runId: string;
  capabilityId: string;
  capabilityVersion: string;
  effect: string;
  risk: string;
  status: string;
  title: string;
  summary: string;
  target: unknown | null;
  input: unknown;
  inputHash: string;
  idempotencyKey: string | null;
  output: unknown | null;
  error: unknown | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  approval?: { id: string } | null;
}

interface ApprovalRow {
  id: string;
  threadId: string;
  runId: string;
  actionId: string;
  status: string;
  reason: string;
  actionInputHash: string;
  requestedAt: Date;
  expiresAt: Date | null;
  decision: unknown | null;
}

interface EventRow {
  eventId: string;
  threadId: string;
  runId: string;
  rootRunId: string;
  parentRunId: string | null;
  sequence: bigint | number;
  type: string;
  payload: unknown;
  occurredAt: Date;
}

interface ActivityRow {
  id: string;
  runId: string;
  parentActivityId: string | null;
  kind: string;
  label: string;
  detail: string | null;
  progress: number | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  firstEventSequence: bigint | number;
  lastEventSequence: bigint | number;
}

export function toStudioAgentThread(row: ThreadRow): StudioAgentThread {
  return StudioAgentThreadSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: row.id,
    surfaceId: row.surfaceId,
    scenario: {
      id: row.scenarioId,
      version: row.scenarioVersion,
    },
    scope: {
      workspaceId: row.workspaceId,
      container: StudioAgentResourceRefSchema.parse(row.scopeContainer),
      focus:
        row.scopeFocus === null
          ? null
          : StudioAgentResourceRefSchema.parse(row.scopeFocus),
    },
    title: row.title,
    ownerActorId: row.ownerActorId,
    status: row.status,
    permissionPolicy: StudioAgentPermissionPolicySchema.parse(
      row.permissionPolicy,
    ),
    activeRunId: row.activeRunId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function toStudioAgentMessage(row: MessageRow): StudioAgentMessage {
  return StudioAgentMessageSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    messageId: row.id,
    clientMessageId: row.clientMessageId,
    threadId: row.threadId,
    runId: row.runId,
    ordinal: safeInteger(row.ordinal, 'message ordinal'),
    role: row.role,
    status: row.status,
    parts: arrayOfMessageParts(row.parts),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  });
}

export function toStudioAgentRun(row: RunRow): StudioAgentRun {
  return StudioAgentRunSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    runId: row.id,
    threadId: row.threadId,
    rootRunId: row.rootRunId,
    parentRunId: row.parentRunId,
    kind: row.kind,
    task:
      row.task === null
        ? null
        : StudioAgentTaskDescriptorSchema.parse(row.task),
    trigger: row.trigger,
    triggerMessageId: row.triggerMessageId,
    scenario: {
      id: row.scenarioId,
      version: row.scenarioVersion,
    },
    permissionPolicy: StudioAgentPermissionPolicySchema.parse(
      row.permissionPolicy,
    ),
    status: row.status,
    phase: row.phase,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    error: row.error === null ? null : StudioAgentErrorSchema.parse(row.error),
  });
}

export function toStudioAgentInput(row: InputRow): StudioAgentInput {
  return StudioAgentInputSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    inputId: row.id,
    threadId: row.threadId,
    targetRunId: row.targetRunId,
    messageId: row.messageId,
    delivery: row.delivery,
    status: row.status,
    sequence: safeInteger(row.sequence, 'input sequence'),
    promotedToRunId: row.promotedToRunId,
    acceptedAt: row.acceptedAt.toISOString(),
    consumedAt: row.consumedAt?.toISOString() ?? null,
  });
}

export function toStudioAgentAction(row: ActionRow): StudioAgentAction {
  return StudioAgentActionSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    actionId: row.id,
    threadId: row.threadId,
    runId: row.runId,
    capability: {
      id: row.capabilityId,
      version: row.capabilityVersion,
    },
    effect: row.effect,
    risk: row.risk,
    status: row.status,
    title: row.title,
    summary: row.summary,
    target:
      row.target === null
        ? null
        : StudioAgentResourceRefSchema.parse(row.target),
    input: StudioAgentJsonObjectSchema.parse(row.input),
    inputHash: row.inputHash,
    approvalId: row.approval?.id ?? null,
    idempotencyKey: row.idempotencyKey,
    output:
      row.output === null ? null : StudioAgentJsonValueSchema.parse(row.output),
    error: row.error === null ? null : StudioAgentErrorSchema.parse(row.error),
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  });
}

export function toStudioAgentApproval(row: ApprovalRow): StudioAgentApproval {
  return StudioAgentApprovalSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    approvalId: row.id,
    threadId: row.threadId,
    runId: row.runId,
    actionId: row.actionId,
    status: row.status,
    reason: row.reason,
    actionInputHash: row.actionInputHash,
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    decision: row.decision,
  });
}

export function toStudioAgentEvent(row: EventRow): StudioAgentEvent {
  return StudioAgentEventSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    eventId: row.eventId,
    threadId: row.threadId,
    runId: row.runId,
    rootRunId: row.rootRunId,
    parentRunId: row.parentRunId,
    sequence: safeInteger(row.sequence, 'event sequence'),
    type: row.type,
    payload: row.payload,
    occurredAt: row.occurredAt.toISOString(),
  });
}

export function toStudioAgentActivitySnapshot(
  row: ActivityRow,
): StudioAgentActivitySnapshot {
  return StudioAgentActivitySnapshotSchema.parse({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    activityId: row.id,
    runId: row.runId,
    parentActivityId: row.parentActivityId,
    kind: row.kind,
    label: row.label,
    detail: row.detail,
    progress: row.progress,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    firstEventSequence: safeInteger(
      row.firstEventSequence,
      'activity first event sequence',
    ),
    lastEventSequence: safeInteger(
      row.lastEventSequence,
      'activity last event sequence',
    ),
  });
}

export function toStudioAgentWorkflowInput(
  row: RunRow,
): StudioAgentWorkflowInput {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: row.threadId,
    runId: row.id,
    rootRunId: row.rootRunId,
    parentRunId: row.parentRunId,
    kind: StudioAgentRunSchema.parse(toStudioAgentRun(row)).kind,
    scenario: {
      id: row.scenarioId,
      version: row.scenarioVersion,
    },
    permissionPolicy: {
      policyId: StudioAgentPermissionPolicySchema.parse(row.permissionPolicy)
        .policyId,
      revision: StudioAgentPermissionPolicySchema.parse(row.permissionPolicy)
        .revision,
    },
  };
}

function arrayOfMessageParts(value: unknown) {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((part) => StudioAgentMessagePartSchema.parse(part));
}

function safeInteger(value: bigint | number, label: string): number {
  const numeric = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new RangeError(`${label} exceeds the wire contract's safe range.`);
  }
  return numeric;
}
